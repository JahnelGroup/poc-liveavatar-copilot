"use client";

import { useCallback, useMemo, useState } from "react";

type VendorName = "liveavatar" | "deepgram" | "elevenlabs" | "copilot";
type VendorStatus = "pass" | "warn" | "fail";

type VendorCheckResult = {
  vendor: VendorName;
  status: VendorStatus;
  missingEnv?: string[];
  error?: string;
  hint?: string;
  whereToGetIt?: string;
  authMode?: string;
  details?: unknown;
};

type VendorCheckResponse = {
  results?: VendorCheckResult[];
};

const VENDOR_LABELS: Record<VendorName, string> = {
  liveavatar: "LiveAvatar",
  deepgram: "Deepgram",
  elevenlabs: "ElevenLabs",
  copilot: "Copilot Studio",
};

const STATUS_LABELS: Record<VendorStatus, string> = {
  pass: "Pass",
  warn: "Warn",
  fail: "Fail",
};

const STATUS_CARD_STYLES: Record<VendorStatus, string> = {
  pass: "border-emerald-700/70 bg-emerald-900/20",
  warn: "border-amber-700/70 bg-amber-900/20",
  fail: "border-rose-700/70 bg-rose-900/20",
};

const STATUS_BADGE_STYLES: Record<VendorStatus, string> = {
  pass: "bg-emerald-600/80 text-white",
  warn: "bg-amber-600/80 text-white",
  fail: "bg-rose-600/80 text-white",
};

type ConfigCheckProps = {
  getAccessToken?: () => Promise<string>;
};

export function ConfigCheck({ getAccessToken }: ConfigCheckProps) {
  const [results, setResults] = useState<VendorCheckResult[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const sortedResults = useMemo(() => {
    if (!results) {
      return [];
    }

    const order: Record<VendorName, number> = {
      liveavatar: 1,
      deepgram: 2,
      elevenlabs: 3,
      copilot: 4,
    };

    return [...results].sort((a, b) => order[a.vendor] - order[b.vendor]);
  }, [results]);

  const runChecks = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (getAccessToken) {
        try {
          const token = await getAccessToken();
          headers["Authorization"] = `Bearer ${token}`;
        } catch {
          // Fall through without token — diagnostics will use server-side auth.
        }
      }

      const response = await fetch("/api/diagnostics/vendors", {
        method: "POST",
        headers,
      });

      const bodyText = await response.text();
      if (!response.ok) {
        throw new Error(bodyText || `Configuration check request failed (${response.status})`);
      }

      let payload: VendorCheckResponse = {};
      try {
        payload = JSON.parse(bodyText) as VendorCheckResponse;
      } catch {
        throw new Error("Configuration check route returned invalid JSON.");
      }

      if (!Array.isArray(payload.results)) {
        throw new Error("Configuration check response was missing results.");
      }

      setResults(payload.results);
      setIsExpanded(true);
    } catch (requestError) {
      setError((requestError as Error).message);
      setResults(null);
      setIsExpanded(false);
    } finally {
      setIsLoading(false);
    }
  }, [getAccessToken]);

  return (
    <section className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium text-white">Configuration Check</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void runChecks()}
            disabled={isLoading}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
          >
            {isLoading ? "Checking..." : "Run Configuration Check"}
          </button>
          {results ? (
            <button
              type="button"
              onClick={() => setIsExpanded((prev) => !prev)}
              className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-600"
            >
              {isExpanded ? "Hide Results" : "Show Results"}
            </button>
          ) : null}
        </div>
      </div>

      <p className="text-sm text-slate-400">
        Validates vendor keys/settings and returns actionable hints without exposing secrets.
      </p>

      {error ? <p className="text-sm text-rose-400">{error}</p> : null}

      {isExpanded && sortedResults.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {sortedResults.map((result) => (
            <article
              key={result.vendor}
              className={`space-y-2 rounded-lg border p-3 ${STATUS_CARD_STYLES[result.status]}`}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-white">{VENDOR_LABELS[result.vendor]}</h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_STYLES[result.status]}`}
                >
                  {STATUS_LABELS[result.status]}
                </span>
              </div>

              {result.authMode ? (
                <p className="text-xs text-slate-300">Auth mode: {result.authMode}</p>
              ) : null}

              {result.error ? <p className="text-sm text-rose-300">Error: {result.error}</p> : null}

              {result.hint ? <p className="text-sm text-amber-200">Hint: {result.hint}</p> : null}

              {result.missingEnv && result.missingEnv.length > 0 ? (
                <p className="text-sm text-slate-200">
                  Missing env: <span className="text-slate-300">{result.missingEnv.join(", ")}</span>
                </p>
              ) : null}

              {result.whereToGetIt ? (
                <p className="text-xs text-slate-400">Where to get it: {result.whereToGetIt}</p>
              ) : null}

              {result.details ? (
                <details className="rounded border border-slate-700 bg-slate-950/60 p-2 text-xs text-slate-300">
                  <summary className="cursor-pointer select-none text-slate-200">Debug details</summary>
                  <pre className="mt-2 overflow-auto whitespace-pre-wrap">
                    {JSON.stringify(result.details, null, 2)}
                  </pre>
                </details>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
