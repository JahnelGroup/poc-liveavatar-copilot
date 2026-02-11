const DEFAULT_ENTRA_SCOPE = "https://api.powerplatform.com/.default";
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const COPILOT_DEBUG_ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

type CachedToken = {
  accessToken: string;
  expiresAtMs: number;
};

type EntraTokenResponse = {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type EntraErrorPayload = {
  error?: string;
  error_description?: string;
  code?: string;
  message?: string;
};

export type SafeTokenClaims = {
  aud?: string;
  tid?: string;
  appid?: string;
  azp?: string;
  scp?: string;
  roles?: string[];
  exp?: number;
};

export type ServiceDiagnostics = {
  service: "entra" | "copilot";
  status?: number;
  endpoint?: {
    host: string;
    path: string;
  };
  requestId?: string;
  correlationId?: string;
  traceparent?: string;
  errorCode?: string;
  errorMessage?: string;
};

type ServiceErrorOptions = {
  diagnostics: ServiceDiagnostics;
  hint?: string;
};

export class ServiceError extends Error {
  diagnostics: ServiceDiagnostics;
  hint?: string;

  constructor(message: string, options: ServiceErrorOptions) {
    super(message);
    this.name = "ServiceError";
    this.diagnostics = options.diagnostics;
    this.hint = options.hint;
  }
}

let cachedToken: CachedToken | null = null;

function trimEnv(name: string) {
  return process.env[name]?.trim() ?? "";
}

function tryParseJson(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${normalized}${"=".repeat((4 - (normalized.length % 4)) % 4)}`;
  return Buffer.from(padded, "base64").toString("utf-8");
}

function summarizeEndpoint(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.host,
    path: parsed.pathname,
  };
}

function getHeader(headers: Headers, name: string) {
  return headers.get(name) ?? undefined;
}

function parseErrorPayload(payload: unknown): EntraErrorPayload {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const typed = payload as {
    error?: string | { code?: string; message?: string };
    error_description?: string;
    code?: string;
    message?: string;
  };

  if (typeof typed.error === "string") {
    return {
      error: typed.error,
      error_description: typed.error_description,
      code: typed.code,
      message: typed.message,
    };
  }

  if (typed.error && typeof typed.error === "object") {
    return {
      error: typed.error.code,
      error_description: typed.error_description,
      code: typed.error.code ?? typed.code,
      message: typed.error.message ?? typed.message,
    };
  }

  return {
    error_description: typed.error_description,
    code: typed.code,
    message: typed.message,
  };
}

function buildEntraHint(status?: number) {
  if (status === 403) {
    return "Entra token was rejected. Verify admin consent, app permissions, and that the token audience/scope matches Power Platform Copilot API.";
  }
  if (status === 401) {
    return "Entra client credentials may be invalid. Verify ENTRA_TENANT_ID, ENTRA_CLIENT_ID, and ENTRA_CLIENT_SECRET.";
  }
  return undefined;
}

function buildServiceDiagnostics(params: {
  endpoint: string;
  status?: number;
  headers?: Headers;
  payload?: unknown;
}) {
  const payload = parseErrorPayload(params.payload);
  return {
    service: "entra" as const,
    status: params.status,
    endpoint: summarizeEndpoint(params.endpoint),
    requestId:
      getHeader(params.headers ?? new Headers(), "x-ms-request-id") ??
      getHeader(params.headers ?? new Headers(), "request-id"),
    correlationId:
      getHeader(params.headers ?? new Headers(), "x-ms-correlation-request-id") ??
      getHeader(params.headers ?? new Headers(), "x-correlation-id"),
    traceparent: getHeader(params.headers ?? new Headers(), "traceparent"),
    errorCode: payload.code ?? payload.error,
    errorMessage: payload.message ?? payload.error_description,
  };
}

export function getSafeTokenClaims(accessToken: string): SafeTokenClaims {
  const parts = accessToken.split(".");
  if (parts.length < 2) {
    return {};
  }

  try {
    const payload = JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>;
    const roles = Array.isArray(payload.roles)
      ? payload.roles.filter((entry): entry is string => typeof entry === "string")
      : undefined;

    return {
      aud: typeof payload.aud === "string" ? payload.aud : undefined,
      tid: typeof payload.tid === "string" ? payload.tid : undefined,
      appid: typeof payload.appid === "string" ? payload.appid : undefined,
      azp: typeof payload.azp === "string" ? payload.azp : undefined,
      scp: typeof payload.scp === "string" ? payload.scp : undefined,
      roles,
      exp: typeof payload.exp === "number" ? payload.exp : undefined,
    };
  } catch {
    return {};
  }
}

export function isCopilotDebugEnabled() {
  const value = trimEnv("COPILOT_DEBUG").toLowerCase();
  return COPILOT_DEBUG_ENABLED_VALUES.has(value);
}

export function getMissingEntraConfigKeys() {
  const required = [
    "ENTRA_TENANT_ID",
    "ENTRA_CLIENT_ID",
    "ENTRA_CLIENT_SECRET",
  ] as const;

  return required.filter((name) => !trimEnv(name));
}

export function hasEntraCopilotConfig() {
  return getMissingEntraConfigKeys().length === 0;
}

export function getEntraCopilotConfig() {
  const missing = getMissingEntraConfigKeys();
  if (missing.length > 0) {
    throw new Error(`Missing Entra Copilot config: ${missing.join(", ")}`);
  }

  return {
    tenantId: trimEnv("ENTRA_TENANT_ID"),
    clientId: trimEnv("ENTRA_CLIENT_ID"),
    clientSecret: trimEnv("ENTRA_CLIENT_SECRET"),
    scope: trimEnv("ENTRA_SCOPE") || DEFAULT_ENTRA_SCOPE,
  };
}

export async function getEntraToken() {
  if (cachedToken && cachedToken.expiresAtMs - TOKEN_REFRESH_BUFFER_MS > Date.now()) {
    return cachedToken.accessToken;
  }

  const config = getEntraCopilotConfig();
  const tokenEndpoint = `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: config.scope,
  });

  try {
    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      cache: "no-store",
    });

    const textPayload = await response.text();
    const jsonPayload = tryParseJson(textPayload);
    const payload = (jsonPayload ?? {}) as EntraTokenResponse;
    if (!response.ok || !payload.access_token) {
      const diagnostics = buildServiceDiagnostics({
        endpoint: tokenEndpoint,
        status: response.status,
        headers: response.headers,
        payload: jsonPayload ?? { message: textPayload },
      });
      const detailText =
        diagnostics.errorMessage?.trim() || diagnostics.errorCode?.trim() || `HTTP ${response.status}`;
      throw new ServiceError(`Failed to acquire Entra token: ${detailText}`, {
        diagnostics,
        hint: buildEntraHint(response.status),
      });
    }

    const expiresInSeconds = payload.expires_in ?? 3600;
    cachedToken = {
      accessToken: payload.access_token,
      expiresAtMs: Date.now() + expiresInSeconds * 1000,
    };

    return payload.access_token;
  } catch (error) {
    if (error instanceof ServiceError) {
      throw error;
    }

    const diagnostics = buildServiceDiagnostics({
      endpoint: tokenEndpoint,
    });

    throw new ServiceError(`Failed to acquire Entra token: ${(error as Error).message}`, {
      diagnostics,
      hint: "Network or DNS issue while contacting Entra token endpoint.",
    });
  }
}
