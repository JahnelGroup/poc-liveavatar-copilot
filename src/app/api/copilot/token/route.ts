import { NextResponse } from "next/server";
import { startCopilotConversation } from "@/lib/copilot-api";
import { generateDirectLineToken } from "@/lib/directline";
import {
  getEntraToken,
  getSafeTokenClaims,
  hasEntraCopilotConfig,
  isCopilotDebugEnabled,
  ServiceError,
} from "@/lib/entra-auth";

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

  // Legacy fallback paths
  const tokenEndpoint = process.env.COPILOT_TOKEN_ENDPOINT?.trim();
  const secret = process.env.COPILOT_DIRECTLINE_SECRET;

  // SDK path requires these env vars
  const hasSDKConfig =
    Boolean(process.env.COPILOT_ENVIRONMENT_ID?.trim()) &&
    Boolean(process.env.COPILOT_AGENT_SCHEMA_NAME?.trim());

  try {
    // ---------------------------------------------------------------
    // Priority path 0: Delegated Entra token from browser (MSAL).
    // Uses the official Copilot Studio SDK.
    // ---------------------------------------------------------------
    if (delegatedBearerToken && hasSDKConfig) {
      let tokenClaims = undefined;
      try {
        tokenClaims = getSafeTokenClaims(delegatedBearerToken);
        const payload = await startCopilotConversation({
          bearerToken: delegatedBearerToken,
        });

        return NextResponse.json(
          {
            token: "entra-delegated",
            conversationId: payload.conversationId,
            method: "entra-delegated",
          },
          { status: 200 },
        );
      } catch (delegatedError) {
        const status = toStatusCode(delegatedError, 500);
        const responsePayload: {
          error: string;
          details: string;
          hint?: string;
          diagnostics?: unknown;
        } = {
          error: "Failed to initialize Copilot authentication",
          details: (delegatedError as Error).message,
        };

        if (delegatedError instanceof ServiceError && delegatedError.hint) {
          responsePayload.hint = delegatedError.hint;
        }

        if (debugEnabled && delegatedError instanceof ServiceError) {
          responsePayload.diagnostics = {
            ...delegatedError.diagnostics,
            tokenClaims,
          };
        }

        return NextResponse.json(responsePayload, { status });
      }
    }

    // ---------------------------------------------------------------
    // Priority path 1: Server-side Entra app-only (client_credentials).
    // Uses the official Copilot Studio SDK.
    // ---------------------------------------------------------------
    if (hasSDKConfig && hasEntraCopilotConfig()) {
      let tokenClaims = undefined;
      try {
        const bearerToken = await getEntraToken();
        tokenClaims = getSafeTokenClaims(bearerToken);
        const payload = await startCopilotConversation({
          bearerToken,
        });

        return NextResponse.json(
          {
            token: "entra-managed",
            conversationId: payload.conversationId,
            method: "entra",
          },
          { status: 200 },
        );
      } catch (entraError) {
        const status = toStatusCode(entraError, 500);
        const responsePayload: {
          error: string;
          details: string;
          hint?: string;
          diagnostics?: unknown;
        } = {
          error: "Failed to initialize Copilot authentication",
          details: (entraError as Error).message,
        };

        if (entraError instanceof ServiceError && entraError.hint) {
          responsePayload.hint = entraError.hint;
        }

        if (debugEnabled && entraError instanceof ServiceError) {
          responsePayload.diagnostics = {
            ...entraError.diagnostics,
            tokenClaims,
          };
        }

        return NextResponse.json(responsePayload, { status });
      }
    }

    // ---------------------------------------------------------------
    // Priority path 2: Copilot Studio token endpoint URL (legacy).
    // ---------------------------------------------------------------
    if (tokenEndpoint) {
      const response = await fetch(tokenEndpoint, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Copilot token endpoint request failed: ${response.status}`);
      }

      const tokenResponse = (await response.json()) as {
        token?: string;
        conversationId?: string;
        expires_in?: number;
      };

      if (!tokenResponse.token) {
        throw new Error("Copilot token endpoint response missing token");
      }

      return NextResponse.json({ ...tokenResponse, method: "directline" }, { status: 200 });
    }

    // ---------------------------------------------------------------
    // Priority path 3: Classic Direct Line secret (legacy).
    // ---------------------------------------------------------------
    if (!secret) {
      return NextResponse.json(
        {
          error:
            "Missing Copilot configuration. Set COPILOT_ENVIRONMENT_ID + COPILOT_AGENT_SCHEMA_NAME, " +
            "or Entra vars, COPILOT_TOKEN_ENDPOINT, or COPILOT_DIRECTLINE_SECRET.",
        },
        { status: 500 },
      );
    }

    const tokenResponse = await generateDirectLineToken(secret);
    return NextResponse.json({ ...tokenResponse, method: "directline" }, { status: 200 });
  } catch (error) {
    const status = toStatusCode(error, 500);
    const payload: {
      error: string;
      details: string;
      hint?: string;
      diagnostics?: unknown;
    } = {
      error: "Failed to initialize Copilot authentication",
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
