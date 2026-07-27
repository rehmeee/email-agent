"use client";

import { useCallback, useEffect, useState } from "react";
import { DraftAttachmentChips } from "@/components/dashboard/draft-attachment-chip";

type MailMindDraft = {
  id: string;
  gmailDraftId: string;
  source: "inbox" | "chat";
  to: string;
  subject: string;
  body: string;
  attachments?: Array<{
    driveFileId: string;
    name: string;
    mimeType?: string;
    exportFormat?: string;
  }> | null;
  updatedAt: string;
};

type DraftsPanelProps = {
  enabled: boolean;
};

export function DraftsPanel({ enabled }: DraftsPanelProps) {
  const [drafts, setDrafts] = useState<MailMindDraft[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [feedbackById, setFeedbackById] = useState<Record<string, string>>({});
  const [actingId, setActingId] = useState<string | null>(null);

  const [statusById, setStatusById] = useState<Record<string, string>>({});

  const loadDrafts = useCallback(async () => {
    if (!enabled) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/agent/drafts/list");
      const payload = (await response.json()) as {
        drafts?: MailMindDraft[];
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
      try {
        const response = await fetch("/api/agent/drafts/list");
        const payload = (await response.json()) as {
          drafts?: MailMindDraft[];
          error?: string;
        };

        if (cancelled) return;

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load drafts");
        }

        setDrafts(payload.drafts ?? []);
        setError(null);
      } catch (loadError) {
        if (cancelled) return;
        const message =
          loadError instanceof Error
            ? loadError.message
            : "Failed to load drafts";
        setError(message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  async function submitFeedback(draft: MailMindDraft) {
    const feedback = (feedbackById[draft.id] ?? "").trim();
    if (!feedback) return;

    setActingId(draft.id);
    setError(null);

    try {
      const response = await fetch("/api/agent/drafts/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: draft.id, feedback }),
      });
      const payload = (await response.json()) as {
        error?: string;
        reply?: string;
        draft?: { to: string; subject: string; body: string };
        gmailDraftId?: string;
        id?: string | null;
        redrafted?: boolean;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to revise draft");
      }

      setFeedbackById((current) => ({ ...current, [draft.id]: "" }));
      if (payload.reply) {
        setStatusById((current) => ({
          ...current,
          [draft.id]: payload.reply!,
        }));
      }
      await loadDrafts();
      if (payload.id) {
        setExpandedId(payload.id);
      }
    } catch (reviseError) {
      setError(
        reviseError instanceof Error
          ? reviseError.message
          : "Failed to revise draft"
      );
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="glass-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
        <div>
          <h2 className="font-semibold">MailMind Drafts</h2>
          <p className="text-xs text-zinc-500">
            Inbox and chat drafts MailMind created — review and improve here
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
              When the inbox agent drafts a reply, or you accept a chat draft, it
              appears here. Run the mailmind_drafts migration if this stays empty
              after drafts are created.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {drafts.map((draft) => {
              const expanded = expandedId === draft.id;
              const isActing = actingId === draft.id;

              return (
                <li
                  key={draft.id}
                  className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() =>
                      setExpandedId((current) =>
                        current === draft.id ? null : draft.id
                      )
                    }
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">
                          {draft.subject}
                        </p>
                        <p className="mt-1 truncate text-xs text-zinc-500">
                          To: {draft.to}
                        </p>
                        {!expanded ? (
                          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-zinc-400">
                            {draft.body}
                          </p>
                        ) : null}
                      </div>
                      <span className="shrink-0 rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-medium text-indigo-300">
                        {draft.source === "inbox" ? "Inbox" : "Chat"}
                      </span>
                    </div>
                  </button>

                  {draft.attachments?.length ? (
                    <div className="mt-3">
                      <p className="mb-2 text-[11px] font-medium text-zinc-500">
                        Attachments — click to open and review
                      </p>
                      <DraftAttachmentChips attachments={draft.attachments} />
                    </div>
                  ) : null}

                  {expanded ? (
                    <div className="mt-4 space-y-3 border-t border-white/[0.06] pt-4">
                      <pre className="whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-sm leading-relaxed text-zinc-300">
                        {draft.body}
                      </pre>
                      <label className="block text-xs text-zinc-500">
                        Change this (updates persona + replaces Gmail draft via MCP)
                        <textarea
                          value={feedbackById[draft.id] ?? ""}
                          onChange={(event) =>
                            setFeedbackById((current) => ({
                              ...current,
                              [draft.id]: event.target.value,
                            }))
                          }
                          rows={3}
                          placeholder="e.g. make this shorter and less formal"
                          className="mt-2 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-400/40"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={
                          isActing || !(feedbackById[draft.id] ?? "").trim()
                        }
                        onClick={() => void submitFeedback(draft)}
                        className="rounded-full bg-indigo-500/90 px-4 py-2 text-xs font-medium text-white transition hover:bg-indigo-400 disabled:opacity-50"
                      >
                        {isActing ? "Improving draft..." : "Submit feedback"}
                      </button>
                      {statusById[draft.id] ? (
                        <p className="text-xs text-emerald-300/90">
                          {statusById[draft.id]}
                        </p>
                      ) : null}
                      <p className="text-[11px] text-zinc-600">
                        Updated {new Date(draft.updatedAt).toLocaleString()} ·
                        Gmail draft {draft.gmailDraftId}
                      </p>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
