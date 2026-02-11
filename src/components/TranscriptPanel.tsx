"use client";

import React, { useMemo } from "react";
import type { ConversationMessage } from "@/lib/types";

// ---------------------------------------------------------------------------
// Citation parsing helpers
// ---------------------------------------------------------------------------

/** A source extracted from citation reference blocks like `[1]: https://... "title"` */
type CitationSource = {
  index: number;
  url: string;
  title: string;
};

/**
 * Splits a bot message into the body text (with inline markers) and an array
 * of citation sources. Citation reference blocks live at the end of the text
 * and follow the pattern `[n]: url "title"` or `[n]: url`.
 */
function extractCitations(text: string): { body: string; sources: CitationSource[] } {
  const sources: CitationSource[] = [];
  // Match citation reference blocks: [1]: https://example.com "Optional title"
  const refPattern = /\n?\[(\d+)\]:\s*(https?:\/\/\S+?)(?:\s+"([^"]*)")?\s*$/gm;

  let body = text;
  let match: RegExpExecArray | null;

  while ((match = refPattern.exec(text)) !== null) {
    const idx = parseInt(match[1], 10);
    const url = match[2];
    // Use the title if present, otherwise derive from the URL hostname
    let title = match[3]?.trim() || "";
    if (!title) {
      try {
        title = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        title = url;
      }
    }
    sources.push({ index: idx, url, title });
  }

  // Remove the citation reference blocks from the body
  body = body.replace(/\n?\[(\d+)\]:\s*https?:\/\/\S+(?:\s+"[^"]*")?\s*$/gm, "").trim();

  return { body, sources };
}

/**
 * Renders a text segment, converting:
 *  - Inline citation markers `[1]` → superscript badges
 *  - Markdown links `[text](url)` → clickable <a> tags
 *  - **bold** → <strong>
 */
function renderFormattedText(text: string, sources: CitationSource[]): React.ReactNode[] {
  // Combined pattern: markdown links, inline citations, or bold
  const combinedPattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|\[(\d+)\]|\*\*([^*]+)\*\*/g;

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = combinedPattern.exec(text)) !== null) {
    // Push text before this match
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[1] !== undefined && match[2] !== undefined) {
      // Markdown link: [text](url)
      nodes.push(
        <a
          key={`link-${match.index}`}
          href={match[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 underline hover:text-blue-300"
        >
          {match[1]}
        </a>,
      );
    } else if (match[3] !== undefined) {
      // Inline citation: [1]
      const idx = parseInt(match[3], 10);
      const source = sources.find((s) => s.index === idx);
      if (source) {
        nodes.push(
          <a
            key={`cite-${match.index}`}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            title={source.title}
            className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-blue-600/30 text-[10px] font-semibold text-blue-300 align-super hover:bg-blue-600/50"
          >
            {idx}
          </a>,
        );
      } else {
        // No matching source — still render as superscript badge
        nodes.push(
          <sup
            key={`cite-${match.index}`}
            className="ml-0.5 text-[10px] font-semibold text-slate-400"
          >
            [{idx}]
          </sup>,
        );
      }
    } else if (match[4] !== undefined) {
      // Bold: **text**
      nodes.push(
        <strong key={`bold-${match.index}`} className="font-semibold">
          {match[4]}
        </strong>,
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Push remaining text
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type TranscriptPanelProps = {
  messages: ConversationMessage[];
};

function FormattedBotMessage({ text }: { text: string }) {
  const { body, sources } = useMemo(() => extractCitations(text), [text]);

  return (
    <>
      <p className="whitespace-pre-wrap text-sm text-slate-100">
        {renderFormattedText(body, sources)}
      </p>
      {sources.length > 0 && (
        <div className="mt-2 border-t border-slate-700 pt-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Sources
          </p>
          <ol className="list-none space-y-0.5">
            {sources.map((s) => (
              <li key={s.index} className="flex items-baseline gap-1.5 text-xs">
                <span className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-blue-600/30 text-[10px] font-semibold text-blue-300">
                  {s.index}
                </span>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-blue-400 underline hover:text-blue-300"
                  title={s.url}
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}

export function TranscriptPanel({ messages }: TranscriptPanelProps) {
  return (
    <div className="min-h-60 w-full flex-1 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-4 lg:h-0 lg:min-h-0">
      {messages.length === 0 ? (
        <p className="text-sm text-slate-400">No conversation yet.</p>
      ) : (
        <ul className="space-y-3">
          {messages.map((msg) => (
            <li key={msg.id} className="rounded-lg border border-slate-700 bg-slate-950/70 p-3">
              <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">
                {msg.role === "user" ? "You" : "Copilot"}
              </p>
              {msg.role === "assistant" ? (
                <FormattedBotMessage text={msg.text} />
              ) : (
                <p className="text-sm text-slate-100">{msg.text}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
