import { NextResponse } from "next/server";
import { cleanBotReply, sendCardSubmitAction } from "@/lib/copilot-api";
import {
  getEntraToken,
  hasEntraCopilotConfig,
  isCopilotDebugEnabled,
  ServiceError,
} from "@/lib/entra-auth";
import type { CopilotAuthMethod } from "@/lib/types";

type SubmitActionBody = {
  method?: CopilotAuthMethod;
  conversationId?: string;
  submitAction?: Record<string, unknown>;
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
    const body = (await request.json()) as SubmitActionBody;
    const conversationId = body.conversationId?.trim();
    const submitAction = body.submitAction;
    const method: CopilotAuthMethod =
      body.method ?? (hasEntraCopilotConfig() ? "entra" : "directline");

    if (!conversationId || !submitAction || typeof submitAction !== "object") {
      return NextResponse.json(
        { error: "conversationId and submitAction are required" },
        { status: 400 },
      );
    }

    // Resolve the Power Platform bearer token (same logic as message route)
    let bearerToken: string | null = null;
    if (method === "entra-delegated") {
      bearerToken = delegatedBearerToken;
    } else if (method === "entra") {
      bearerToken = await getEntraToken();
    }

    if (!bearerToken) {
      return NextResponse.json(
        { error: "Missing bearer token for Copilot API authentication" },
        { status: 401 },
      );
    }

    const result = await sendCardSubmitAction({
      bearerToken,
      conversationId,
      submitAction,
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
  } catch (error) {
    const status = toStatusCode(error, 500);
    const payload: {
      error: string;
      details: string;
      hint?: string;
      diagnostics?: unknown;
    } = {
      error: "Failed to submit card action to Copilot",
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
