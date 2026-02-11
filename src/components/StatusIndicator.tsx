"use client";

import type { UiStatus } from "@/lib/types";

const LABELS: Record<UiStatus, string> = {
  idle: "Idle",
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Error",
};

const COLORS: Record<UiStatus, string> = {
  idle: "bg-slate-500",
  connecting: "bg-amber-500",
  listening: "bg-emerald-500",
  thinking: "bg-cyan-500",
  speaking: "bg-fuchsia-500",
  error: "bg-rose-500",
};

type StatusIndicatorProps = {
  status: UiStatus;
  extraText?: string | null;
};

export function StatusIndicator({ status, extraText }: StatusIndicatorProps) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-sm text-slate-100">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${COLORS[status]}`} />
      <span>{LABELS[status]}</span>
      {extraText ? <span className="text-slate-400">- {extraText}</span> : null}
    </div>
  );
}
