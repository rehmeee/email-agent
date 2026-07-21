"use client";

import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MailMindRobot } from "@/components/dashboard/mailmind-robot";

type DraftPreview = {
  to: string;
  subject: string;
  body: string;
  gmailThreadId?: string;
  inReplyTo?: string;
  references?: string;
};

type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  messageId?: string | null;
  draft?: DraftPreview | null;
  draftStatus?: "pending" | "accepted" | "revised" | null;
};

type ChatThread = {
  id: string;
  title: string;
  updatedAt: string;
};

type AgentChatProps = {
  enabled: boolean;
  onDraftsMaybeCreated?: () => void;
};

const STARTER_PROMPTS = [
  "Show my 5 most recent emails",
  "What unread emails do I have?",
  "Draft a polite reply to my latest email",
];

const THINKING_MESSAGES = [
  "Reading your inbox...",
  "Searching relevant emails...",
  "Analyzing messages...",
  "Preparing your answer...",
];

function UserAvatar() {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-[10px] font-semibold text-zinc-300">
      You
    </div>
  );
}

function AgentThinkingPanel({ message }: { message: string }) {
  return (
    <div className="flex gap-4 rounded-2xl border border-indigo-500/15 bg-indigo-500/[0.06] px-4 py-4">
      <MailMindRobot state="thinking" size="md" />
      <div className="min-w-0 flex-1 pt-1">
        <p className="text-sm font-medium text-indigo-200">MailMind is thinking</p>
        <p className="mt-1 text-sm text-zinc-400">{message}</p>
        <div className="mt-3 flex gap-1.5">
          <span className="chat-typing-dot" />
          <span className="chat-typing-dot animation-delay-150" />
          <span className="chat-typing-dot animation-delay-300" />
        </div>
      </div>
    </div>
  );
}

function DraftPreviewCard({ draft }: { draft: DraftPreview }) {
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-black/25 px-4 py-3">
      <div className="space-y-1 text-sm">
        <p className="text-zinc-400">
          <span className="font-medium text-zinc-300">To:</span> {draft.to}
        </p>
        <p className="text-zinc-400">
          <span className="font-medium text-zinc-300">Subject:</span> {draft.subject}
        </p>
      </div>
      <div className="border-t border-white/10 pt-3">
        <p className="whitespace-pre-wrap text-[15px] leading-7 text-zinc-100">
          {draft.body}
        </p>
      </div>
    </div>
  );
}

function AssistantMessage({
  content,
  animate,
  messageKey,
  draft,
  draftStatus,
  isGivingFeedback,
  feedbackText,
  onFeedbackTextChange,
  onStartFeedback,
  onCancelFeedback,
  onSubmitFeedback,
  onAccept,
  isActing,
}: {
  content: string;
  animate?: boolean;
  messageKey: string;
  draft?: DraftPreview | null;
  draftStatus?: "pending" | "accepted" | "revised" | null;
  isGivingFeedback?: boolean;
  feedbackText?: string;
  onFeedbackTextChange?: (value: string) => void;
  onStartFeedback?: (messageKey: string) => void;
  onCancelFeedback?: () => void;
  onSubmitFeedback?: (messageKey: string) => void;
  onAccept?: (messageKey: string) => void;
  isActing?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <MailMindRobot state={animate ? "speaking" : "idle"} size="sm" />
      <div className="min-w-0 flex-1 pt-1 text-[15px] leading-7 text-zinc-200">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-indigo-300/80">
          MailMind
        </p>
        <p className="whitespace-pre-wrap">{content}</p>
        {draft ? <DraftPreviewCard draft={draft} /> : null}
        {draft && draftStatus === "pending" && !isGivingFeedback ? (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={isActing}
              aria-label="Thumbs up — save draft to Gmail"
              title="Save to Gmail Drafts"
              onClick={() => onAccept?.(messageKey)}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/15 text-base transition hover:bg-emerald-500/25 disabled:opacity-50"
            >
              👍
            </button>
            <button
              type="button"
              disabled={isActing}
              aria-label="Thumbs down — give feedback"
              title="Give feedback"
              onClick={() => onStartFeedback?.(messageKey)}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-base transition hover:bg-white/[0.12] disabled:opacity-50"
            >
              👎
            </button>
          </div>
        ) : null}
        {draft && draftStatus === "pending" && isGivingFeedback ? (
          <div className="mt-3 space-y-2 rounded-xl border border-rose-500/25 bg-rose-500/[0.08] px-3 py-3">
            <p className="text-xs font-medium text-rose-100/90">
              What should MailMind change? Feedback updates your writing persona, then a new draft is proposed.
            </p>
            <textarea
              rows={3}
              value={feedbackText ?? ""}
              onChange={(event) => onFeedbackTextChange?.(event.target.value)}
              placeholder="e.g. Too formal — make it shorter and friendlier"
              disabled={isActing}
              className="w-full resize-y rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-rose-400/40 disabled:opacity-50"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isActing || !(feedbackText ?? "").trim()}
                onClick={() => onSubmitFeedback?.(messageKey)}
                className="rounded-full bg-rose-500/90 px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-rose-400 disabled:opacity-50"
              >
                {isActing ? "Improving draft..." : "Submit feedback"}
              </button>
              <button
                type="button"
                disabled={isActing}
                onClick={() => onCancelFeedback?.()}
                className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-[11px] font-semibold text-zinc-200 transition hover:bg-white/[0.1] disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {draft && draftStatus === "accepted" ? (
          <p className="mt-2 text-xs text-emerald-300/90">
            Draft accepted and saved to Gmail → Drafts.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function AgentChat({ enabled, onDraftsMaybeCreated }: AgentChatProps) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thinkingStep, setThinkingStep] = useState(0);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [isActingOnDraft, setIsActingOnDraft] = useState(false);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [feedbackMessageKey, setFeedbackMessageKey] = useState<string | null>(
    null
  );
  const [feedbackText, setFeedbackText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const statusLabel = useMemo(() => {
    if (!enabled) return "locked";
    if (isLoading) return "thinking";
    return "online";
  }, [enabled, isLoading]);

  const thinkingMessage =
    THINKING_MESSAGES[thinkingStep % THINKING_MESSAGES.length];

  const loadThreadMessages = useCallback(
    async (threadId: string) => {
      setIsLoadingMessages(true);
      setError(null);

      try {
        const response = await fetch(`/api/chat/threads/${threadId}`);
        const payload = (await response.json()) as {
          messages?: Array<{
            id?: string;
            role: "user" | "assistant";
            content: string;
            draft?: DraftPreview | null;
            draftStatus?: "pending" | "accepted" | "revised" | null;
            messageId?: string | null;
          }>;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load messages");
        }

        setMessages(
          (payload.messages ?? []).map((item) => ({
            id: item.id ?? item.messageId ?? undefined,
            role: item.role,
            content: item.content,
            messageId: item.messageId ?? item.id ?? null,
            draft: item.draft ?? null,
            draftStatus: item.draftStatus ?? null,
          }))
        );
        setActiveThreadId(threadId);
      } catch (loadError) {
        const message =
          loadError instanceof Error ? loadError.message : "Failed to load chat";
        setError(message);
      } finally {
        setIsLoadingMessages(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    void (async () => {
      setIsLoadingThreads(true);
      try {
        const response = await fetch("/api/chat/threads");
        const payload = (await response.json()) as {
          threads?: ChatThread[];
          error?: string;
        };

        if (cancelled) return;

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load chats");
        }

        setThreads(payload.threads ?? []);
      } catch {
        if (!cancelled) setThreads([]);
      } finally {
        if (!cancelled) setIsLoadingThreads(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, isLoading, error, thinkingMessage]);

  useEffect(() => {
    if (!isLoading) return;

    const interval = window.setInterval(() => {
      setThinkingStep((current) => current + 1);
    }, 1800);

    return () => window.clearInterval(interval);
  }, [isLoading]);

  useEffect(() => {
    if (speakingIndex === null) return;

    const timeout = window.setTimeout(() => {
      setSpeakingIndex(null);
    }, 1200);

    return () => window.clearTimeout(timeout);
  }, [speakingIndex]);

  function startNewChat() {
    setActiveThreadId(null);
    setMessages([]);
    setError(null);
    setInput("");
  }

  function resizeTextarea() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !enabled || isLoading) return;

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: trimmed },
    ];

    setMessages(nextMessages);
    setInput("");
    setError(null);
    setThinkingStep(0);
    setIsLoading(true);

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          threadId: activeThreadId,
        }),
      });

      const payload = (await response.json()) as {
        reply?: string;
        threadId?: string;
        threadTitle?: string;
        draft?: DraftPreview | null;
        messageId?: string | null;
        draftStatus?: "pending" | "accepted" | "revised" | null;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Agent request failed");
      }

      const assistantIndex = nextMessages.length;
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: payload.reply ?? "No response returned.",
          messageId: payload.messageId ?? null,
          draft: payload.draft ?? null,
          draftStatus: payload.draftStatus ?? (payload.draft ? "pending" : null),
        },
      ]);
      setSpeakingIndex(assistantIndex);

      if (payload.threadId) {
        setActiveThreadId(payload.threadId);
        setThreads((current) => {
          const existing = current.find((thread) => thread.id === payload.threadId);
          const updatedThread = {
            id: payload.threadId!,
            title: payload.threadTitle ?? trimmed.slice(0, 48),
            updatedAt: new Date().toISOString(),
          };

          if (existing) {
            return [
              updatedThread,
              ...current.filter((thread) => thread.id !== payload.threadId),
            ];
          }

          return [updatedThread, ...current];
        });
      }
    } catch (sendError) {
      const message =
        sendError instanceof Error ? sendError.message : "Agent request failed";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendMessage(input);
  }

  function messageKeyFor(message: ChatMessage, index: number) {
    return message.messageId ?? message.id ?? `idx-${index}`;
  }

  function findMessageByKey(messageKey: string) {
    return messages.find(
      (message, index) => messageKeyFor(message, index) === messageKey
    );
  }

  async function handleAcceptDraft(messageKey: string) {
    if (isActingOnDraft) return;
    const target = findMessageByKey(messageKey);
    if (!target?.draft) return;

    setFeedbackMessageKey(null);
    setFeedbackText("");
    setIsActingOnDraft(true);
    setError(null);

    try {
      const response = await fetch("/api/agent/drafts/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId: target.messageId,
          threadId: activeThreadId,
          draft: target.draft,
        }),
      });
      const payload = (await response.json()) as {
        reply?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to accept draft");
      }

      setMessages((current) => [
        ...current.map((message, index) =>
          messageKeyFor(message, index) === messageKey
            ? { ...message, draftStatus: "accepted" as const }
            : message
        ),
        {
          role: "assistant",
          content: payload.reply ?? "Draft saved to Gmail → Drafts.",
        },
      ]);
      onDraftsMaybeCreated?.();
    } catch (acceptError) {
      setError(
        acceptError instanceof Error
          ? acceptError.message
          : "Failed to accept draft"
      );
    } finally {
      setIsActingOnDraft(false);
    }
  }

  function handleStartFeedback(messageKey: string) {
    if (isActingOnDraft) return;
    setError(null);
    setFeedbackMessageKey(messageKey);
    setFeedbackText("");
  }

  function handleCancelFeedback() {
    if (isActingOnDraft) return;
    setFeedbackMessageKey(null);
    setFeedbackText("");
  }

  async function handleSubmitFeedback(messageKey: string) {
    if (isActingOnDraft) return;

    const trimmed = feedbackText.trim();
    if (!trimmed) {
      setError("Feedback is required.");
      return;
    }

    const target = findMessageByKey(messageKey);
    if (!target?.draft) return;

    setIsActingOnDraft(true);
    setError(null);

    try {
      const response = await fetch("/api/agent/drafts/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId: target.messageId,
          threadId: activeThreadId,
          feedback: trimmed,
          draft: target.draft,
        }),
      });
      const payload = (await response.json()) as {
        reply?: string;
        draft?: DraftPreview | null;
        messageId?: string | null;
        draftStatus?: "pending" | null;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to submit feedback");
      }

      setMessages((current) => {
        const updated = current.map((message, index) =>
          messageKeyFor(message, index) === messageKey
            ? { ...message, draftStatus: "revised" as const }
            : message
        );

        return [
          ...updated,
          {
            role: "user" as const,
            content: `Draft feedback: ${trimmed}`,
          },
          {
            role: "assistant" as const,
            content:
              payload.reply ??
              "Got it — I'll keep this in mind. Here's the updated draft.",
            messageId: payload.messageId ?? null,
            draft: payload.draft ?? null,
            draftStatus: payload.draft
              ? ("pending" as const)
              : payload.draftStatus ?? null,
          },
        ];
      });

      setFeedbackMessageKey(null);
      setFeedbackText("");
    } catch (feedbackError) {
      setError(
        feedbackError instanceof Error
          ? feedbackError.message
          : "Failed to submit feedback"
      );
    } finally {
      setIsActingOnDraft(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  }

  async function handleDeleteThread(threadId: string) {
    if (deletingThreadId || isLoading) return;

    const confirmed = window.confirm(
      "Delete this chat? This cannot be undone."
    );
    if (!confirmed) return;

    setDeletingThreadId(threadId);
    setError(null);

    try {
      const response = await fetch(`/api/chat/threads/${threadId}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete chat");
      }

      setThreads((current) => current.filter((thread) => thread.id !== threadId));

      if (activeThreadId === threadId) {
        setActiveThreadId(null);
        setMessages([]);
        setSpeakingIndex(null);
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete chat"
      );
    } finally {
      setDeletingThreadId(null);
    }
  }

  return (
    <div className="glass-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl lg:flex-row">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-white/[0.06] bg-black/20 lg:flex">
        <div className="border-b border-white/[0.06] p-3">
          <button
            type="button"
            onClick={startNewChat}
            disabled={!enabled}
            className="w-full rounded-xl bg-white px-3 py-2 text-xs font-semibold text-zinc-900 transition hover:bg-zinc-100 disabled:opacity-50"
          >
            + New chat
          </button>
        </div>
        <div className="chat-scroll min-h-0 flex-1 overflow-y-auto p-2">
          {isLoadingThreads ? (
            <p className="px-2 py-3 text-xs text-zinc-500">Loading chats...</p>
          ) : threads.length === 0 ? (
            <p className="px-2 py-3 text-xs text-zinc-500">No previous chats yet</p>
          ) : (
            <ul className="space-y-1">
              {threads.map((thread) => (
                <li key={thread.id}>
                  <div
                    className={`group flex items-center gap-1 rounded-lg pr-1 transition ${
                      activeThreadId === thread.id
                        ? "bg-white/[0.08] text-white"
                        : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => void loadThreadMessages(thread.id)}
                      className="min-w-0 flex-1 px-3 py-2 text-left text-xs"
                    >
                      <p className="truncate font-medium">{thread.title}</p>
                    </button>
                    <button
                      type="button"
                      title="Delete chat"
                      aria-label={`Delete chat ${thread.title}`}
                      disabled={deletingThreadId === thread.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDeleteThread(thread.id);
                      }}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 opacity-0 transition hover:bg-red-500/15 hover:text-red-300 group-hover:opacity-100 focus:opacity-100 disabled:opacity-50"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.8}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0v12a1 1 0 001 1h6a1 1 0 001-1V7M10 11v6M14 11v6"
                        />
                      </svg>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-white/[0.06] px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <MailMindRobot
                state={!enabled ? "locked" : isLoading ? "thinking" : "idle"}
                size="sm"
              />
              <div>
                <h2 className="font-semibold">AI Agent</h2>
                <p className="text-xs text-zinc-500">LangGraph · OpenRouter · Gmail</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={startNewChat}
                disabled={!enabled}
                className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[10px] font-medium text-zinc-300 transition hover:bg-white/[0.08] disabled:opacity-50 lg:hidden"
              >
                New chat
              </button>
              <div className="flex items-center gap-2 rounded-full border border-white/[0.06] bg-black/20 px-3 py-1">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    statusLabel === "online"
                      ? "bg-emerald-400"
                      : statusLabel === "thinking"
                        ? "bg-amber-400 animate-pulse"
                        : "bg-zinc-600"
                  }`}
                />
                <span className="font-mono text-[10px] text-zinc-500">{statusLabel}</span>
              </div>
            </div>
          </div>
        </div>

        <div ref={scrollRef} className="chat-scroll min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
            {!enabled ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
                <MailMindRobot state="locked" size="lg" />
                <h3 className="mt-5 text-lg font-semibold">Connect Gmail to start</h3>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-zinc-500">
                  The agent needs Gmail access before it can read or summarize your inbox.
                </p>
              </div>
            ) : isLoadingMessages ? (
              <div className="flex min-h-[320px] items-center justify-center text-sm text-zinc-500">
                Loading conversation...
              </div>
            ) : messages.length === 0 ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
                <MailMindRobot state="idle" size="lg" />
                <h3 className="mt-5 text-lg font-semibold">Hey, I&apos;m MailMind</h3>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-zinc-500">
                  I can search your inbox, summarize threads, and draft replies. Your
                  chats are saved automatically.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {STARTER_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => sendMessage(prompt)}
                      className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-300 transition hover:border-indigo-500/30 hover:bg-indigo-500/10 hover:text-white"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-8">
                {messages.map((message, index) =>
                  message.role === "user" ? (
                    <div key={`${message.role}-${index}`} className="flex justify-end gap-3">
                      <div className="max-w-[85%] rounded-3xl bg-white/[0.08] px-4 py-3 text-[15px] leading-7 text-zinc-100">
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      </div>
                      <UserAvatar />
                    </div>
                  ) : (
                    <AssistantMessage
                      key={`${message.role}-${index}`}
                      content={message.content}
                      animate={speakingIndex === index}
                      messageKey={messageKeyFor(message, index)}
                      draft={message.draft}
                      draftStatus={message.draftStatus}
                      isGivingFeedback={
                        feedbackMessageKey === messageKeyFor(message, index)
                      }
                      feedbackText={feedbackText}
                      onFeedbackTextChange={setFeedbackText}
                      onStartFeedback={handleStartFeedback}
                      onCancelFeedback={handleCancelFeedback}
                      onSubmitFeedback={handleSubmitFeedback}
                      onAccept={handleAcceptDraft}
                      isActing={isActingOnDraft}
                    />
                  )
                )}

                {isLoading || isActingOnDraft ? (
                  <AgentThinkingPanel
                    message={
                      isActingOnDraft
                        ? "Updating persona and rewriting your draft..."
                        : thinkingMessage
                    }
                  />
                ) : null}

                {error ? (
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                    {error}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-white/[0.06] bg-[#030304]/60 px-4 py-4 backdrop-blur-xl sm:px-6">
          <form onSubmit={handleSubmit} className="mx-auto max-w-3xl">
            <div className="relative flex items-end gap-2 rounded-[28px] border border-white/[0.1] bg-[#141416] px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.35)] focus-within:border-indigo-500/40 focus-within:ring-1 focus-within:ring-indigo-500/20">
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  resizeTextarea();
                }}
                onKeyDown={handleKeyDown}
                placeholder={
                  enabled
                    ? "Message MailMind..."
                    : "Connect Gmail to unlock the agent"
                }
                disabled={!enabled || isLoading}
                className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent text-[15px] leading-6 text-white outline-none placeholder:text-zinc-600 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!enabled || isLoading || !input.trim()}
                aria-label="Send message"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-zinc-900 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 12h14M12 5l7 7-7 7"
                  />
                </svg>
              </button>
            </div>
            <p className="mt-2 text-center text-[11px] text-zinc-600">
              Enter to send · Shift+Enter for new line
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
