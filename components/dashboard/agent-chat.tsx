"use client";

import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MailMindRobot } from "@/components/dashboard/mailmind-robot";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type AgentChatProps = {
  enabled: boolean;
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

function AssistantMessage({
  content,
  animate,
}: {
  content: string;
  animate?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <MailMindRobot state={animate ? "speaking" : "idle"} size="sm" />
      <div className="min-w-0 flex-1 pt-1 text-[15px] leading-7 text-zinc-200">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-indigo-300/80">
          MailMind
        </p>
        <p className="whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  );
}

export function AgentChat({ enabled }: AgentChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thinkingStep, setThinkingStep] = useState(0);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const statusLabel = useMemo(() => {
    if (!enabled) return "locked";
    if (isLoading) return "thinking";
    return "online";
  }, [enabled, isLoading]);

  const thinkingMessage =
    THINKING_MESSAGES[thinkingStep % THINKING_MESSAGES.length];

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, isLoading, error, thinkingMessage]);

  useEffect(() => {
    if (!isLoading) {
      setThinkingStep(0);
      return;
    }

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
          history: messages,
        }),
      });

      const payload = (await response.json()) as {
        reply?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Agent request failed");
      }

      const assistantIndex = nextMessages.length;
      setMessages([
        ...nextMessages,
        { role: "assistant", content: payload.reply ?? "No response returned." },
      ]);
      setSpeakingIndex(assistantIndex);
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

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  }

  return (
    <div className="glass-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl">
      <div className="shrink-0 border-b border-white/[0.06] px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MailMindRobot
              state={
                !enabled ? "locked" : isLoading ? "thinking" : "idle"
              }
              size="sm"
            />
            <div>
              <h2 className="font-semibold">AI Agent</h2>
              <p className="text-xs text-zinc-500">LangGraph · OpenRouter · Gmail</p>
            </div>
          </div>
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
          ) : messages.length === 0 ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
              <MailMindRobot state="idle" size="lg" />
              <h3 className="mt-5 text-lg font-semibold">Hey, I&apos;m MailMind</h3>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-zinc-500">
                I can search your inbox, summarize threads, and help you understand
                what needs attention.
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
                  />
                )
              )}

              {isLoading ? (
                <AgentThinkingPanel message={thinkingMessage} />
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
  );
}
