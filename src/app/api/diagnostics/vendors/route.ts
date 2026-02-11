import { NextResponse } from "next/server";
import { startCopilotConversation } from "@/lib/copilot-api";
import { generateDirectLineToken } from "@/lib/directline";
import {
  getEntraToken,
  getMissingEntraConfigKeys,
  getSafeTokenClaims,
  hasEntraCopilotConfig,
  isCopilotDebugEnabled,
  ServiceError,
} from "@/lib/entra-auth";

const LIVEAVATAR_API_URL = process.env.LIVEAVATAR_API_URL ?? "https://api.liveavatar.com";

type VendorName = "liveavatar" | "deepgram" | "elevenlabs" | "copilot";
type VendorStatus = "pass" | "warn" | "fail";
type CopilotAuthMode = "entra" | "entra-delegated" | "tokenEndpoint" | "directlineSecret" | "missing";

type VendorCheckResult = {
  vendor: VendorName;
  status: VendorStatus;
  missingEnv?: string[];
  error?: string;
  hint?: string;
  whereToGetIt: string;
  authMode?: CopilotAuthMode;
  details?: unknown;
};

type LiveAvatarTokenResponse = {
  code?: number;
  message?: string;
  data?: {
    session_token?: string;
  };
};

type ElevenLabsVoicesResponse = {
  voices?: Array<{
    voice_id?: string;
    name?: string;
  }>;
};

function getTrimmedEnv(name: string) {
  return process.env[name]?.trim() ?? "";
}

function truncate(text: string, max = 300) {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...`;
}

function statusFromHttp(status: number): VendorStatus {
  if (status >= 500) {
    return "fail";
  }
  if (status >= 400) {
    return "warn";
  }
  return "pass";
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function getCopilotWhereToGetIt(mode: CopilotAuthMode) {
  if (mode === "entra-delegated") {
    return "User signed in via Microsoft (MSAL delegated). Token is provided by the browser.";
  }
  if (mode === "entra") {
    return "Azure Portal -> Entra ID -> App registrations -> Overview (tenant/client id) and Certificates & secrets (client secret).";
  }
  if (mode === "tokenEndpoint") {
    return "Copilot Studio -> Channels -> Mobile app -> Token Endpoint.";
  }
  if (mode === "directlineSecret") {
    return "Copilot Studio -> Channels -> Mobile app -> Web Channel Security (Direct Line secret).";
  }
  return "Configure one auth mode: Entra (COPILOT_API_ENDPOINT + ENTRA_*), token endpoint, or Direct Line secret.";
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  const token = authorization.slice(7).trim();
  return token || null;
}

async function checkLiveAvatar(debugEnabled: boolean): Promise<VendorCheckResult> {
  const apiKey = getTrimmedEnv("LIVEAVATAR_API_KEY");
  const avatarId = getTrimmedEnv("LIVEAVATAR_AVATAR_ID");
  const isSandbox = (process.env.LIVEAVATAR_IS_SANDBOX ?? "true") === "true";
  const missingEnv = [
    !apiKey ? "LIVEAVATAR_API_KEY" : null,
    !avatarId ? "LIVEAVATAR_AVATAR_ID" : null,
  ].filter((value): value is string => Boolean(value));

  const baseResult = {
    vendor: "liveavatar" as const,
    whereToGetIt:
      "HeyGen/LiveAvatar dashboard -> API Keys for LIVEAVATAR_API_KEY; list/select avatars for LIVEAVATAR_AVATAR_ID.",
  };

  if (missingEnv.length > 0) {
    return {
      ...baseResult,
      status: "fail",
      missingEnv,
      error: "Missing required LiveAvatar environment variables.",
      hint: "Set LIVEAVATAR_API_KEY and LIVEAVATAR_AVATAR_ID in .env.local.",
    };
  }

  try {
    const response = await fetch(`${LIVEAVATAR_API_URL}/v1/sessions/token`, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "LITE",
        avatar_id: avatarId,
        is_sandbox: isSandbox,
      }),
      cache: "no-store",
    });

    const responseText = await response.text();
    const parsed = safeJsonParse(responseText) as LiveAvatarTokenResponse | null;
    const details = truncate(responseText);

    if (!response.ok) {
      const lower = details.toLowerCase();
      let hint = "Check LIVEAVATAR_API_KEY, LIVEAVATAR_AVATAR_ID, and sandbox mode settings.";
      if (lower.includes("avatar not found")) {
        hint = "LIVEAVATAR_AVATAR_ID is invalid for this account/environment. Pick a valid avatar id from /v1/avatars/public.";
      } else if (lower.includes("not supported in sandbox mode")) {
        hint =
          "This avatar does not support sandbox mode. Set LIVEAVATAR_IS_SANDBOX=false or choose a sandbox-compatible avatar.";
      }

      return {
        ...baseResult,
        status: statusFromHttp(response.status),
        error: `LiveAvatar probe failed (HTTP ${response.status}).`,
        hint,
        details: debugEnabled
          ? {
              status: response.status,
              message: parsed?.message ?? details,
              code: parsed?.code,
            }
          : undefined,
      };
    }

    const hasToken = Boolean(parsed?.data?.session_token);
    if (!hasToken) {
      return {
        ...baseResult,
        status: "warn",
        error: "LiveAvatar probe succeeded but did not return session_token.",
        hint: "Verify avatar and account settings for LITE mode.",
        details: debugEnabled ? parsed : undefined,
      };
    }

    return {
      ...baseResult,
      status: "pass",
    };
  } catch (error) {
    return {
      ...baseResult,
      status: "fail",
      error: "LiveAvatar probe failed with an unexpected network/runtime error.",
      hint: "Check internet connectivity and LIVEAVATAR_API_URL.",
      details: debugEnabled ? { message: (error as Error).message } : undefined,
    };
  }
}

async function checkDeepgram(debugEnabled: boolean): Promise<VendorCheckResult> {
  const apiKey = getTrimmedEnv("DEEPGRAM_API_KEY");
  const baseResult = {
    vendor: "deepgram" as const,
    whereToGetIt: "Deepgram Console -> API Keys.",
  };

  if (!apiKey) {
    return {
      ...baseResult,
      status: "fail",
      missingEnv: ["DEEPGRAM_API_KEY"],
      error: "Missing DEEPGRAM_API_KEY.",
      hint: "Set DEEPGRAM_API_KEY in .env.local.",
    };
  }

  try {
    const response = await fetch("https://api.deepgram.com/v1/projects", {
      method: "GET",
      headers: {
        Authorization: `Token ${apiKey}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const details = truncate(await response.text());
      return {
        ...baseResult,
        status: statusFromHttp(response.status),
        error: `Deepgram probe failed (HTTP ${response.status}).`,
        hint:
          response.status === 401 || response.status === 403
            ? "DEEPGRAM_API_KEY is invalid or lacks access. Generate a valid key in Deepgram Console."
            : "Check Deepgram service availability and API key.",
        details: debugEnabled ? { status: response.status, response: details } : undefined,
      };
    }

    return {
      ...baseResult,
      status: "pass",
    };
  } catch (error) {
    return {
      ...baseResult,
      status: "fail",
      error: "Deepgram probe failed with an unexpected network/runtime error.",
      hint: "Check internet connectivity and Deepgram API availability.",
      details: debugEnabled ? { message: (error as Error).message } : undefined,
    };
  }
}

async function checkElevenLabs(debugEnabled: boolean): Promise<VendorCheckResult> {
  const apiKey = getTrimmedEnv("ELEVENLABS_API_KEY");
  const voiceId = getTrimmedEnv("ELEVENLABS_VOICE_ID");
  const missingEnv = [
    !apiKey ? "ELEVENLABS_API_KEY" : null,
    !voiceId ? "ELEVENLABS_VOICE_ID" : null,
  ].filter((value): value is string => Boolean(value));

  const baseResult = {
    vendor: "elevenlabs" as const,
    whereToGetIt: "ElevenLabs dashboard -> Profile/API Keys and Voices page for voice id.",
  };

  if (missingEnv.length > 0) {
    return {
      ...baseResult,
      status: "fail",
      missingEnv,
      error: "Missing required ElevenLabs environment variables.",
      hint: "Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env.local.",
    };
  }

  try {
    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      method: "GET",
      headers: {
        "xi-api-key": apiKey,
      },
      cache: "no-store",
    });

    const responseText = await response.text();
    const parsed = safeJsonParse(responseText) as ElevenLabsVoicesResponse | null;

    if (!response.ok) {
      return {
        ...baseResult,
        status: statusFromHttp(response.status),
        error: `ElevenLabs probe failed (HTTP ${response.status}).`,
        hint:
          response.status === 401 || response.status === 403
            ? "ELEVENLABS_API_KEY is invalid or unauthorized. Generate a valid key in ElevenLabs."
            : "Check ElevenLabs service availability and account limits.",
        details: debugEnabled ? { status: response.status, response: truncate(responseText) } : undefined,
      };
    }

    const voices = parsed?.voices ?? [];
    const matchedVoice = voices.find((voice) => voice.voice_id === voiceId);

    if (!matchedVoice) {
      return {
        ...baseResult,
        status: "warn",
        error: "Configured ELEVENLABS_VOICE_ID was not found in this account's voices.",
        hint: "Use an existing voice id from ElevenLabs Voices page, or change to a valid shared voice id.",
        details: debugEnabled ? { availableVoices: voices.length } : undefined,
      };
    }

    return {
      ...baseResult,
      status: "pass",
      details: debugEnabled ? { voiceName: matchedVoice.name, voiceId: matchedVoice.voice_id } : undefined,
    };
  } catch (error) {
    return {
      ...baseResult,
      status: "fail",
      error: "ElevenLabs probe failed with an unexpected network/runtime error.",
      hint: "Check internet connectivity and ElevenLabs API availability.",
      details: debugEnabled ? { message: (error as Error).message } : undefined,
    };
  }
}

async function checkCopilot(debugEnabled: boolean, delegatedBearerToken?: string | null): Promise<VendorCheckResult> {
  const apiEndpoint = getTrimmedEnv("COPILOT_API_ENDPOINT");
  const tenantId = getTrimmedEnv("ENTRA_TENANT_ID");
  const clientId = getTrimmedEnv("ENTRA_CLIENT_ID");
  const clientSecret = getTrimmedEnv("ENTRA_CLIENT_SECRET");
  const tokenEndpoint = getTrimmedEnv("COPILOT_TOKEN_ENDPOINT");
  const directLineSecret = getTrimmedEnv("COPILOT_DIRECTLINE_SECRET");
  const hasAnyEntraValue = Boolean(apiEndpoint || tenantId || clientId || clientSecret);

  const baseResult = {
    vendor: "copilot" as const,
  };

  // SDK-based paths require these env vars
  const hasSDKConfig =
    Boolean(getTrimmedEnv("COPILOT_ENVIRONMENT_ID")) &&
    Boolean(getTrimmedEnv("COPILOT_AGENT_SCHEMA_NAME"));

  // Priority path 0: delegated Entra token from browser (MSAL).
  if (delegatedBearerToken && hasSDKConfig) {
    const authMode: CopilotAuthMode = "entra-delegated";
    try {
      const tokenClaims = getSafeTokenClaims(delegatedBearerToken);
      const payload = await startCopilotConversation({
        bearerToken: delegatedBearerToken,
      });

      return {
        ...baseResult,
        status: "pass",
        authMode,
        whereToGetIt: getCopilotWhereToGetIt(authMode),
        details: debugEnabled ? { conversationId: payload.conversationId, tokenClaims } : undefined,
      };
    } catch (error) {
      if (error instanceof ServiceError) {
        return {
          ...baseResult,
          status: "fail",
          authMode,
          error: error.message,
          hint: error.hint,
          whereToGetIt: getCopilotWhereToGetIt(authMode),
          details: debugEnabled ? error.diagnostics : undefined,
        };
      }

      return {
        ...baseResult,
        status: "fail",
        authMode,
        error: "Copilot delegated auth probe failed with an unexpected runtime error.",
        hint: "Verify your Microsoft sign-in has access to the Copilot agent and Dataverse environment.",
        whereToGetIt: getCopilotWhereToGetIt(authMode),
        details: debugEnabled ? { message: (error as Error).message } : undefined,
      };
    }
  }

  if (hasSDKConfig && hasAnyEntraValue) {
    const authMode: CopilotAuthMode = "entra";
    if (!hasEntraCopilotConfig()) {
      const missing = getMissingEntraConfigKeys();
      return {
        ...baseResult,
        status: "fail",
        authMode,
        missingEnv: missing,
        error: "Incomplete Entra Copilot configuration.",
        hint: "Set all ENTRA_* variables and COPILOT_ENVIRONMENT_ID + COPILOT_AGENT_SCHEMA_NAME, or remove them all to use token endpoint/direct line fallback.",
        whereToGetIt: getCopilotWhereToGetIt(authMode),
      };
    }

    try {
      const bearerToken = await getEntraToken();
      const tokenClaims = getSafeTokenClaims(bearerToken);
      const payload = await startCopilotConversation({
        bearerToken,
      });

      return {
        ...baseResult,
        status: "pass",
        authMode,
        whereToGetIt: getCopilotWhereToGetIt(authMode),
        details: debugEnabled ? { conversationId: payload.conversationId, tokenClaims } : undefined,
      };
    } catch (error) {
      if (error instanceof ServiceError) {
        return {
          ...baseResult,
          status: "fail",
          authMode,
          error: error.message,
          hint: error.hint,
          whereToGetIt: getCopilotWhereToGetIt(authMode),
          details: debugEnabled ? error.diagnostics : undefined,
        };
      }

      return {
        ...baseResult,
        status: "fail",
        authMode,
        error: "Copilot Entra probe failed with an unexpected runtime error.",
        hint: "Verify Entra app registration and Power Platform API access.",
        whereToGetIt: getCopilotWhereToGetIt(authMode),
        details: debugEnabled ? { message: (error as Error).message } : undefined,
      };
    }
  }

  if (tokenEndpoint) {
    const authMode: CopilotAuthMode = "tokenEndpoint";
    try {
      const response = await fetch(tokenEndpoint, {
        method: "GET",
        cache: "no-store",
      });
      const responseText = await response.text();
      const parsed = safeJsonParse(responseText) as
        | {
            token?: string;
            conversationId?: string;
          }
        | null;

      if (!response.ok) {
        return {
          ...baseResult,
          status: statusFromHttp(response.status),
          authMode,
          error: `Copilot token endpoint probe failed (HTTP ${response.status}).`,
          hint: "Confirm COPILOT_TOKEN_ENDPOINT is the Mobile app token endpoint URL and is accessible in your environment.",
          whereToGetIt: getCopilotWhereToGetIt(authMode),
          details: debugEnabled ? { status: response.status, response: truncate(responseText) } : undefined,
        };
      }

      if (!parsed?.token) {
        return {
          ...baseResult,
          status: "warn",
          authMode,
          error: "Copilot token endpoint response did not include token.",
          hint: "Check endpoint URL and agent channel configuration.",
          whereToGetIt: getCopilotWhereToGetIt(authMode),
          details: debugEnabled ? parsed : undefined,
        };
      }

      return {
        ...baseResult,
        status: "pass",
        authMode,
        whereToGetIt: getCopilotWhereToGetIt(authMode),
      };
    } catch (error) {
      return {
        ...baseResult,
        status: "fail",
        authMode,
        error: "Copilot token endpoint probe failed with an unexpected network/runtime error.",
        hint: "Check endpoint URL, networking, and Copilot channel availability.",
        whereToGetIt: getCopilotWhereToGetIt(authMode),
        details: debugEnabled ? { message: (error as Error).message } : undefined,
      };
    }
  }

  if (directLineSecret) {
    const authMode: CopilotAuthMode = "directlineSecret";
    try {
      const payload = await generateDirectLineToken(directLineSecret);
      return {
        ...baseResult,
        status: "pass",
        authMode,
        whereToGetIt: getCopilotWhereToGetIt(authMode),
        details: debugEnabled ? { conversationId: payload.conversationId } : undefined,
      };
    } catch (error) {
      return {
        ...baseResult,
        status: "fail",
        authMode,
        error: (error as Error).message,
        hint: "Verify COPILOT_DIRECTLINE_SECRET is a valid secret (not a URL) and the channel is enabled.",
        whereToGetIt: getCopilotWhereToGetIt(authMode),
      };
    }
  }

  const authMode: CopilotAuthMode = "missing";
  return {
    ...baseResult,
    status: "fail",
    authMode,
    error: "No Copilot auth mode is configured.",
    missingEnv: [
      "COPILOT_API_ENDPOINT + ENTRA_TENANT_ID + ENTRA_CLIENT_ID + ENTRA_CLIENT_SECRET",
      "or COPILOT_TOKEN_ENDPOINT",
      "or COPILOT_DIRECTLINE_SECRET",
    ],
    hint: "Configure one Copilot auth mode in .env.local.",
    whereToGetIt: getCopilotWhereToGetIt(authMode),
  };
}

export async function POST(request: Request) {
  const debugEnabled = isCopilotDebugEnabled();
  const delegatedBearerToken = getBearerToken(request);

  const checks = await Promise.all([
    checkLiveAvatar(debugEnabled),
    checkDeepgram(debugEnabled),
    checkElevenLabs(debugEnabled),
    checkCopilot(debugEnabled, delegatedBearerToken),
  ]);

  return NextResponse.json(
    {
      results: checks,
    },
    { status: 200 },
  );
}
