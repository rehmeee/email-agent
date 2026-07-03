"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";

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
  };
  authError?: string;
  gmailSuccess?: boolean;
  signOutAction: () => Promise<void>;
  connectGmailAction: () => Promise<void>;
};

const sidebarNav = [
  { label: "Overview", active: true, icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { label: "Inbox", active: false, icon: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" },
  { label: "Agent", active: false, icon: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" },
  { label: "Drafts", active: false, icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" },
];

function buildSetupSteps(gmailConnected: boolean) {
  return [
    { label: "Create your MailMind account", done: true },
    { label: "Connect Gmail inbox", done: gmailConnected },
    { label: "Launch AI agent", done: false },
  ];
}

function buildMetrics(gmailConnected: boolean) {
  return [
    {
      label: "Unread today",
      value: "—",
      sub: gmailConnected ? "Sync coming soon" : "Connect Gmail",
    },
    {
      label: "Agent status",
      value: gmailConnected ? "Ready" : "Idle",
      sub: gmailConnected ? "Gmail linked" : "Ready to configure",
    },
    { label: "Drafts", value: "0", sub: "None pending" },
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
  const setupSteps = buildSetupSteps(gmail.connected);
  const metrics = buildMetrics(gmail.connected);

  return (
    <div className="flex min-h-screen bg-[#030304] text-white">
      {/* Sidebar */}
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
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                item.active
                  ? "bg-white/[0.06] text-white"
                  : "text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300"
              }`}
            >
              <svg className="h-4 w-4 shrink-0 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              {item.label}
              {item.active && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-indigo-400" />
              )}
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

      {/* Main */}
      <div className="flex flex-1 flex-col">
        {/* Top bar */}
        <header className="flex items-center justify-between border-b border-white/[0.06] bg-[#030304]/80 px-6 py-4 backdrop-blur-xl">
          <div>
            <p className="text-xs font-medium text-zinc-500">Overview</p>
            <h1 className="text-lg font-semibold">
              Good to see you,{" "}
              <span className="text-gradient-accent">{firstName}</span>
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 sm:flex">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  gmail.connected ? "bg-emerald-400" : "bg-amber-400"
                }`}
              />
              <span className="text-xs text-zinc-400">
                {gmail.connected
                  ? `Gmail connected${gmail.email ? ` · ${gmail.email}` : ""}`
                  : "Gmail not connected"}
              </span>
            </div>
            {gmail.connected ? (
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
                  Connect Gmail
                </button>
              </form>
            )}
          </div>
        </header>

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
            Gmail connected successfully. Your inbox is ready for the agent.
          </div>
        ) : null}

        <main className="flex-1 overflow-auto p-6">
          {/* Metrics */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
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

          <div className="mt-6 grid gap-6 lg:grid-cols-5">
            {/* Setup checklist */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="glass-panel rounded-2xl p-6 lg:col-span-2"
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
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
                      )}
                    </div>
                    <span className={`text-sm ${step.done ? "text-zinc-400" : "text-white"}`}>
                      {step.label}
                    </span>
                  </li>
                ))}
              </ul>
            </motion.div>

            {/* Agent chat placeholder */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="glass-panel flex flex-col rounded-2xl lg:col-span-3"
            >
              <div className="border-b border-white/[0.06] px-6 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold">AI Agent</h2>
                    <p className="text-xs text-zinc-500">LangGraph · OpenRouter</p>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
                    <span className="font-mono text-[10px] text-zinc-500">offline</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
                <div className="relative mb-6">
                  <div className="absolute inset-0 rounded-2xl bg-indigo-500/10 blur-2xl" />
                  <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-indigo-500/20 bg-indigo-500/[0.08]">
                    <svg className="h-8 w-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                  </div>
                </div>
                <h3 className="text-lg font-semibold">Agent chat launches here</h3>
                <p className="mt-2 max-w-sm text-sm text-zinc-500">
                  {gmail.connected
                    ? "Gmail is connected. The LangGraph agent will launch here next."
                    : "Connect Gmail first, then ask questions like “show today’s emails” or “draft a follow-up.”"}
                </p>
              </div>

              <div className="border-t border-white/[0.06] p-4">
                <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-black/30 px-4 py-3 opacity-50">
                  <svg className="h-4 w-4 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span className="text-sm text-zinc-600">
                    {gmail.connected
                      ? "Agent chat unlocks in the next phase"
                      : "Connect Gmail to unlock the agent"}
                  </span>
                </div>
              </div>
            </motion.div>
          </div>
        </main>
      </div>
    </div>
  );
}
