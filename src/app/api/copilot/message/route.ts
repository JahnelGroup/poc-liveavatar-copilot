import { NextResponse } from "next/server";
import { buildPrompt, cleanBotReply, sendCopilotMessage } from "@/lib/copilot-api";
import { pollDirectLineBotReply, sendDirectLineMessage } from "@/lib/directline";
import {
  getEntraToken,
  getSafeTokenClaims,
  hasEntraCopilotConfig,
  isCopilotDebugEnabled,
  ServiceError,
} from "@/lib/entra-auth";
import type { CopilotAuthMethod } from "@/lib/types";

type MessageBody = {
  method?: CopilotAuthMethod;
  token?: string;
  conversationId?: string;
  text?: string;
  watermark?: string;
  userId?: string;
};

function toStatusCode(error: unknown, fallback = 500) {
  if (error instanceof ServiceError && typeof error.diagnostics.status === "number") {
    return error.diagnostics.status;
  }
  return fallback;
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = authorization.slice(7).trim();
  return token || null;
}

export async function POST(request: Request) {
  const debugEnabled = isCopilotDebugEnabled();
  const delegatedBearerToken = getBearerToken(request);
  try {
    const body = (await request.json()) as MessageBody;
    const token = body.token?.trim();
    const conversationId = body.conversationId?.trim();
    const text = body.text?.trim();
    const method: CopilotAuthMethod = body.method ?? (hasEntraCopilotConfig() ? "entra" : "directline");

    // -------------------------------------------------------------------
    // SDK path: entra / entra-delegated
    // -------------------------------------------------------------------
    if (method === "entra" || method === "entra-delegated") {
      if (!conversationId || !text) {
        return NextResponse.json(
          { error: "conversationId and text are required for entra method" },
          { status: 400 },
        );
      }

      let tokenClaims = undefined;
      try {
        const bearerToken =
          method === "entra-delegated"
            ? delegatedBearerToken
            : await getEntraToken();
        if (!bearerToken) {
          return NextResponse.json(
            { error: "Missing Authorization bearer token for entra-delegated method" },
            { status: 401 },
          );
        }

        tokenClaims = getSafeTokenClaims(bearerToken);

        const result = await sendCopilotMessage({
          bearerToken,
          conversationId,
          text: buildPrompt(text),
          userId: body.userId,
        });

        const rawReply = result.botReply ?? "";
        return NextResponse.json(
          {
            botReply: rawReply,
            speechText: cleanBotReply(rawReply),
            signinCard: result.signinCard,
          },
          { status: 200 },
        );
      } catch (entraError) {
        const status = toStatusCode(entraError, 500);
        const payload: {
          error: string;
          details: string;
          hint?: string;
          diagnostics?: unknown;
        } = {
          error: "Failed to exchange message with Copilot",
          details: (entraError as Error).message,
        };

        if (entraError instanceof ServiceError && entraError.hint) {
          payload.hint = entraError.hint;
        }

        if (debugEnabled && entraError instanceof ServiceError) {
          payload.diagnostics = {
            ...entraError.diagnostics,
            tokenClaims,
          };
        }

        return NextResponse.json(payload, { status });
      }
    }

    // -------------------------------------------------------------------
    // Legacy Direct Line path
    // -------------------------------------------------------------------
    if (!token || !conversationId || !text) {
      return NextResponse.json(
        { error: "token, conversationId, and text are required for directline method" },
        { status: 400 },
      );
    }

    await sendDirectLineMessage({
      token,
      conversationId,
      text: buildPrompt(text),
      userId: body.userId,
    });

    const reply = await pollDirectLineBotReply({
      token,
      conversationId,
      watermark: body.watermark,
      timeoutMs: 30_000,
      intervalMs: 1_500,
    });

    const rawReply = reply.botReply ?? "";
    return NextResponse.json(
      {
        ...reply,
        botReply: rawReply,
        speechText: cleanBotReply(rawReply),
      },
      { status: 200 },
    );
  } catch (error) {
    const status = toStatusCode(error, 500);
    const payload: {
      error: string;
      details: string;
      hint?: string;
      diagnostics?: unknown;
    } = {
      error: "Failed to exchange message with Copilot",
      details: (error as Error).message,
    };
    if (error instanceof ServiceError && error.hint) {
      payload.hint = error.hint;
    }
    if (debugEnabled && error instanceof ServiceError) {
      payload.diagnostics = error.diagnostics;
    }
    return NextResponse.json(payload, { status });
  }
}
