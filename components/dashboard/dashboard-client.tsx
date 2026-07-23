"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AgentChat } from "@/components/dashboard/agent-chat";
import { DraftsPanel } from "@/components/dashboard/drafts-panel";

type DashboardClientProps = {
  user: {
    name: string;
    email: string;
    image: string | null;
  };
  gmail: {
    connected: boolean;
    email: string | null;
    connectedAt: string | null;
    setupRequired?: boolean;
    needsReconnect?: boolean;
    agentReady?: boolean;
  };
  authError?: string;
  gmailSuccess?: boolean;
  signOutAction: () => Promise<void>;
  connectGmailAction: () => Promise<void>;
};

type DashboardView = "overview" | "drafts";

const sidebarNav: { label: string; view: DashboardView; icon: string }[] = [
  {
    label: "Overview",
    view: "overview",
    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  },
  {
    label: "Drafts",
    view: "drafts",
    icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
  },
];

const viewTitles: Record<DashboardView, string> = {
  overview: "Overview",
  drafts: "Drafts",
};

function buildSetupSteps(gmailConnected: boolean, agentReady: boolean) {
  return [
    { label: "Create your MailMind account", done: true },
    { label: "Connect Gmail & Calendar", done: gmailConnected },
    { label: "Launch AI agent", done: agentReady },
  ];
}

function buildMetrics(
  gmailConnected: boolean,
  agentReady: boolean,
  draftCount: number | null
) {
  return [
    {
      label: "Unread today",
      value: "—",
      sub: agentReady ? "Sync coming soon" : "Connect Gmail",
    },
    {
      label: "Agent status",
      value: agentReady ? "Online" : "Idle",
      sub: agentReady ? "LangGraph ready" : "Needs Gmail scopes",
    },
    {
      label: "Drafts",
      value: draftCount == null ? "—" : String(draftCount),
      sub:
        draftCount == null
          ? gmailConnected
            ? "Loading..."
            : "Connect Gmail"
          : draftCount === 0
            ? "None pending"
            : `${draftCount} in Gmail`,
    },
    { label: "Model", value: "GPT-4o mini", sub: "via OpenRouter" },
  ];
}

export function DashboardClient({
  user,
  gmail,
  authError,
  gmailSuccess,
  signOutAction,
  connectGmailAction,
}: DashboardClientProps) {
  const firstName = user.name.split(" ")[0];
  const agentReady = gmail.agentReady ?? false;
  const setupSteps = buildSetupSteps(gmail.connected, agentReady);
  const setupComplete = setupSteps.every((step) => step.done);

  const [activeView, setActiveView] = useState<DashboardView>("overview");
  const [draftCount, setDraftCount] = useState<number | null>(null);
  const [draftsRefreshKey, setDraftsRefreshKey] = useState(0);
  const [personaStatus, setPersonaStatus] = useState<
    "idle" | "building" | "ready" | "failed" | null
  >(null);
  const [personaMessage, setPersonaMessage] = useState<string | null>(null);
  const [personaDefaulted, setPersonaDefaulted] = useState(false);
  const [personaRetryToken, setPersonaRetryToken] = useState(0);

  const metrics = buildMetrics(gmail.connected, agentReady, draftCount);

  useEffect(() => {
    if (!agentReady) return;

    let cancelled = false;
    const bootKey = "mailmind_persona_boot_started";
    const maxAttempts = 3;

    async function postBootstrap(attempt: number) {
      if (attempt > 1) {
        setPersonaStatus("building");
        setPersonaMessage(
          "Something went wrong building your writing persona. Retrying…"
        );
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }

      const response = await fetch("/api/agent/persona/bootstrap", {
        method: "POST",
      });
      const payload = (await response.json()) as {
        reply?: string;
        status?: string;
        error?: string;
        skipped?: boolean;
        personaDefaulted?: boolean;
        sourceSampleCount?: number;
      };

      return { response, payload };
    }

    void (async () => {
      try {
        const statusResponse = await fetch("/api/agent/persona/bootstrap");
        const statusPayload = (await statusResponse.json()) as {
          status?: string | null;
          error?: string;
          personaDefaulted?: boolean;
          sourceSampleCount?: number;
        };

        if (cancelled) return;

        const currentStatus = statusPayload.status ?? null;

        if (currentStatus === "ready") {
          setPersonaStatus("ready");
          setPersonaDefaulted(Boolean(statusPayload.personaDefaulted));
          if (gmailSuccess) {
            setPersonaMessage(
              "Gmail connected. Your existing writing persona is unchanged."
            );
          } else if (statusPayload.personaDefaulted) {
            setPersonaMessage(
              "Using a neutral default writing voice for now (not enough Sent mail to learn your style). It will improve from draft feedback."
            );
          }
          return;
        }

        if (currentStatus === "building") {
          setPersonaStatus("building");
          setPersonaMessage("Building your writing persona from Sent mail...");
          return;
        }

        const shouldBuild =
          currentStatus == null || currentStatus === "failed";

        if (!shouldBuild) {
          setPersonaStatus("ready");
          return;
        }

        if (
          typeof sessionStorage !== "undefined" &&
          sessionStorage.getItem(bootKey) === "1" &&
          personaRetryToken === 0
        ) {
          setPersonaStatus("building");
          setPersonaMessage("Building your writing persona from Sent mail...");
          return;
        }

        sessionStorage.setItem(bootKey, "1");
        setPersonaStatus("building");
        setPersonaMessage("Building your writing persona from Sent mail...");

        let lastError = "Persona bootstrap failed";
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          if (cancelled) return;

          const { response, payload } = await postBootstrap(attempt);

          if (cancelled) return;

          if (response.ok) {
            sessionStorage.removeItem(bootKey);
            setPersonaDefaulted(Boolean(payload.personaDefaulted));
            setPersonaStatus(
              payload.status === "ready" ||
                payload.status === "failed" ||
                payload.status === "building"
                ? payload.status
                : "ready"
            );
            setPersonaMessage(
              payload.skipped
                ? "Your writing persona is already ready."
                : (payload.reply ?? "Persona ready.")
            );
            return;
          }

          lastError = payload.error ?? "Persona bootstrap failed";
          // Don't spin forever on auth/scope issues
          if (
            lastError.toLowerCase().includes("reconnect") ||
            lastError.toLowerCase().includes("permission") ||
            lastError.toLowerCase().includes("scope")
          ) {
            break;
          }
        }

        sessionStorage.removeItem(bootKey);
        setPersonaStatus("failed");
        setPersonaMessage(lastError);
      } catch (error) {
        sessionStorage.removeItem(bootKey);
        if (!cancelled) {
          setPersonaStatus("failed");
          setPersonaMessage(
            error instanceof Error ? error.message : "Persona bootstrap failed"
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agentReady, gmailSuccess, personaRetryToken]);

  useEffect(() => {
    if (!agentReady) return;

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/gmail/drafts");
        const payload = (await response.json()) as {
          drafts?: unknown[];
          error?: string;
        };

        if (cancelled) return;

        if (!response.ok) {
          setDraftCount(0);
          return;
        }

        setDraftCount(payload.drafts?.length ?? 0);
      } catch {
        if (!cancelled) setDraftCount(0);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agentReady, draftsRefreshKey]);

  function handleDraftsMaybeCreated() {
    setDraftsRefreshKey((current) => current + 1);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#030304] text-white">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-white/[0.06] bg-[#050506] lg:flex">
        <div className="border-b border-white/[0.06] px-5 py-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold">
              M
            </div>
            <div>
              <p className="text-sm font-semibold">MailMind</p>
              <p className="text-[10px] text-zinc-600">Workspace</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {sidebarNav.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => setActiveView(item.view)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                activeView === item.view
                  ? "bg-white/[0.06] text-white"
                  : "text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300"
              }`}
            >
              <svg
                className="h-4 w-4 shrink-0 opacity-70"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              {item.label}
              {activeView === item.view ? (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-indigo-400" />
              ) : null}
            </button>
          ))}
        </nav>

        <div className="border-t border-white/[0.06] p-4">
          <div className="flex items-center gap-3 rounded-xl bg-white/[0.03] p-3">
            {user.image ? (
              <Image
                src={user.image}
                alt={user.name}
                width={32}
                height={32}
                className="rounded-full ring-1 ring-white/10"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold">
                {user.name.charAt(0)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{user.name}</p>
              <p className="truncate text-[10px] text-zinc-600">{user.email}</p>
            </div>
          </div>
          <form action={signOutAction} className="mt-2">
            <button
              type="submit"
              className="w-full rounded-lg px-3 py-2 text-left text-xs text-zinc-500 transition hover:bg-white/[0.04] hover:text-zinc-300"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-white/[0.06] bg-[#030304]/80 px-6 py-4 backdrop-blur-xl">
          <div>
            <p className="text-xs font-medium text-zinc-500">{viewTitles[activeView]}</p>
            <h1 className="text-lg font-semibold">
              Good to see you,{" "}
              <span className="text-gradient-accent">{firstName}</span>
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 sm:flex">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  agentReady
                    ? "bg-emerald-400"
                    : gmail.needsReconnect
                      ? "bg-amber-400"
                      : gmail.connected
                        ? "bg-amber-400"
                        : "bg-amber-400"
                }`}
              />
              <span className="text-xs text-zinc-400">
                {agentReady
                  ? `Gmail & Calendar connected${gmail.email ? ` · ${gmail.email}` : ""}`
                  : gmail.needsReconnect
                    ? "Reconnect needed"
                    : gmail.connected
                      ? "Connected (limited scopes)"
                      : "Gmail not connected"}
              </span>
            </div>
            {agentReady ? (
              <Link
                href="/api/gmail/test"
                target="_blank"
                className="rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/[0.08]"
              >
                Test Gmail API
              </Link>
            ) : (
              <form action={connectGmailAction}>
                <button
                  type="submit"
                  className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-zinc-900 transition hover:bg-zinc-100"
                >
                  {gmail.needsReconnect || gmail.connected
                    ? "Reconnect Gmail & Calendar"
                    : "Connect Gmail & Calendar"}
                </button>
              </form>
            )}
          </div>
        </header>

        {gmail.needsReconnect ? (
          <div className="mx-6 mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Gmail is linked without full inbox, draft, and calendar permissions (this often happens
            after Google sign-in, or when Calendar was added later). Click{" "}
            <strong>Reconnect Gmail & Calendar</strong> and approve read, compose, and calendar
            access on the Google consent screen.
          </div>
        ) : null}

        {gmail.setupRequired ? (
          <div className="mx-6 mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Database setup required. Open Supabase → SQL Editor and run{" "}
            <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">
              supabase/migrations/001_gmail_connections.sql
            </code>
            , then refresh this page.
          </div>
        ) : null}

        {authError ? (
          <div className="mx-6 mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {authError}
          </div>
        ) : null}

        {gmailSuccess ? (
          <div className="mx-6 mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            Gmail connected successfully.
            {personaStatus === "ready"
              ? " Your existing writing persona was kept."
              : personaStatus === "building"
                ? " Creating your writing persona for the first time…"
                : ""}
          </div>
        ) : null}

        {personaStatus === "building" ? (
          <div className="mx-6 mt-4 rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-200">
            {personaMessage ?? "Building your writing persona from Sent mail..."}
          </div>
        ) : null}

        {personaStatus === "ready" && personaMessage ? (
          <div className="mx-6 mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            {personaMessage}
          </div>
        ) : null}

        {personaStatus === "ready" && personaDefaulted && !personaMessage ? (
          <div className="mx-6 mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Using a neutral default writing voice (not enough Sent mail to learn
            your style yet). It will improve from draft feedback.
          </div>
        ) : null}

        {personaStatus === "failed" && personaMessage ? (
          <div className="mx-6 mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {personaMessage}
            {personaMessage.toLowerCase().includes("persona tables are missing") ||
            personaMessage.toLowerCase().includes("schema cache") ? (
              <>
                {" "}
                Run{" "}
                <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">
                  supabase/migrations/003_persona_feedback.sql
                </code>{" "}
                in Supabase, then refresh.
              </>
            ) : (
              <>
                {" "}
                <button
                  type="button"
                  className="ml-2 underline underline-offset-2 hover:text-red-200"
                  onClick={() => {
                    if (typeof sessionStorage !== "undefined") {
                      sessionStorage.removeItem("mailmind_persona_boot_started");
                    }
                    setPersonaStatus("building");
                    setPersonaMessage(
                      "Something went wrong building your writing persona. Retrying…"
                    );
                    setPersonaRetryToken((value) => value + 1);
                  }}
                >
                  Retry
                </button>
              </>
            )}
          </div>
        ) : null}

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
          {activeView === "drafts" ? (
            <div className="min-h-0 flex-1">
              <DraftsPanel key={draftsRefreshKey} enabled={agentReady} />
            </div>
          ) : (
            <>
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                className="grid shrink-0 gap-4 sm:grid-cols-2 xl:grid-cols-4"
              >
                {metrics.map((m, i) => (
                  <motion.div
                    key={m.label}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06 }}
                    className="glass-panel rounded-xl p-5"
                  >
                    <p className="text-xs font-medium text-zinc-500">{m.label}</p>
                    <p className="mt-2 text-2xl font-semibold tracking-tight">{m.value}</p>
                    <p className="mt-1 text-[11px] text-zinc-600">{m.sub}</p>
                  </motion.div>
                ))}
              </motion.div>

              <div className="mt-6 flex min-h-0 flex-1 flex-col gap-6 xl:flex-row">
                {!setupComplete ? (
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                    className="glass-panel shrink-0 rounded-2xl p-6 xl:w-80"
                  >
                    <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400">
                      Setup
                    </p>
                    <h2 className="mt-2 text-lg font-semibold">Get started</h2>
                    <p className="mt-1 text-sm text-zinc-500">
                      Complete these steps to activate your agent.
                    </p>
                    <ul className="mt-6 space-y-3">
                      {setupSteps.map((step) => (
                        <li
                          key={step.label}
                          className="flex items-center gap-3 rounded-xl border border-white/[0.04] bg-white/[0.02] px-4 py-3"
                        >
                          <div
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                              step.done
                                ? "bg-emerald-500/20 text-emerald-400"
                                : "border border-zinc-700 text-zinc-600"
                            }`}
                          >
                            {step.done ? (
                              <svg
                                className="h-3 w-3"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={3}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                            ) : (
                              <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
                            )}
                          </div>
                          <span
                            className={`text-sm ${step.done ? "text-zinc-400" : "text-white"}`}
                          >
                            {step.label}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </motion.div>
                ) : null}

                <div className="min-h-0 flex-1">
                  <AgentChat
                    enabled={agentReady}
                    onDraftsMaybeCreated={handleDraftsMaybeCreated}
                  />
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
