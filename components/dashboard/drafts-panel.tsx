"use client";

import { useCallback, useEffect, useState } from "react";

type GmailDraft = {
  draftId: string;
  messageId: string;
  subject: string;
  to: string;
  snippet: string;
  date: string;
};

type DraftsPanelProps = {
  enabled: boolean;
};

export function DraftsPanel({ enabled }: DraftsPanelProps) {
  const [drafts, setDrafts] = useState<GmailDraft[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDrafts = useCallback(async () => {
    if (!enabled) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/gmail/drafts");
      const payload = (await response.json()) as {
        drafts?: GmailDraft[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load drafts");
      }

      setDrafts(payload.drafts ?? []);
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : "Failed to load drafts";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    void (async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/gmail/drafts");
        const payload = (await response.json()) as {
          drafts?: GmailDraft[];
          error?: string;
        };

        if (cancelled) return;

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load drafts");
        }

        setDrafts(payload.drafts ?? []);
      } catch (loadError) {
        if (cancelled) return;
        const message =
          loadError instanceof Error ? loadError.message : "Failed to load drafts";
        setError(message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return (
    <div className="glass-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
        <div>
          <h2 className="font-semibold">Gmail Drafts</h2>
          <p className="text-xs text-zinc-500">
            Drafts created by MailMind live in your Gmail account
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadDrafts()}
          disabled={!enabled || isLoading}
          className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-white/[0.08] disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      <div className="chat-scroll min-h-0 flex-1 overflow-y-auto p-5">
        {!enabled ? (
          <p className="text-sm text-zinc-500">Connect Gmail to view drafts.</p>
        ) : isLoading ? (
          <p className="text-sm text-zinc-500">Loading drafts...</p>
        ) : error ? (
          <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </p>
        ) : drafts.length === 0 ? (
          <div className="flex min-h-[240px] flex-col items-center justify-center text-center">
            <p className="text-sm font-medium text-zinc-300">No drafts yet</p>
            <p className="mt-2 max-w-sm text-sm text-zinc-500">
              Ask the agent to draft a reply — it will appear here and in Gmail →
              Drafts.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {drafts.map((draft) => (
              <li
                key={draft.draftId}
                className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">
                      {draft.subject}
                    </p>
                    <p className="mt-1 truncate text-xs text-zinc-500">
                      To: {draft.to}
                    </p>
                    <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-zinc-400">
                      {draft.snippet}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-medium text-indigo-300">
                    Draft
                  </span>
                </div>
                {draft.date ? (
                  <p className="mt-3 text-[11px] text-zinc-600">{draft.date}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
