"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

const conversation = [
  { role: "user", text: "Summarize today's inbox and flag urgent threads." },
  {
    role: "agent",
    text: "12 emails today. 3 need replies — client proposal, invoice follow-up, and team standup notes.",
  },
  { role: "user", text: "Draft a polite follow-up to the invoice email." },
  {
    role: "agent",
    text: "Draft ready. Tone: professional. Estimated read time: 18 seconds. Awaiting your approval.",
  },
];

export function ProductPreview() {
  const [visibleLines, setVisibleLines] = useState(1);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisibleLines((v) => (v >= conversation.length ? 1 : v + 1));
    }, 2800);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.3 }}
      className="relative mx-auto w-full max-w-[580px] lg:max-w-none"
    >
      <div className="absolute -inset-4 rounded-3xl shimmer-border opacity-60 blur-sm" />
      <div className="glass-panel relative overflow-hidden rounded-2xl shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-zinc-600" />
              <div className="h-2.5 w-2.5 rounded-full bg-zinc-600" />
              <div className="h-2.5 w-2.5 rounded-full bg-zinc-600" />
            </div>
            <span className="text-xs font-medium text-zinc-500">
              mailmind.app / workspace
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wider text-emerald-400">
              Agent live
            </span>
          </div>
        </div>

        <div className="grid md:grid-cols-5">
          <div className="hidden border-r border-white/[0.06] bg-black/20 p-4 md:col-span-2 md:block">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
              Inbox
            </p>
            <div className="mt-4 space-y-2">
              {[
                { subject: "Q2 proposal review", tag: "Urgent", active: true },
                { subject: "Invoice #4821", tag: "Follow up", active: false },
                { subject: "Team standup notes", tag: "Info", active: false },
              ].map((item) => (
                <div
                  key={item.subject}
                  className={`rounded-lg px-3 py-2.5 text-xs transition ${
                    item.active
                      ? "border border-indigo-500/30 bg-indigo-500/10 text-white"
                      : "text-zinc-500"
                  }`}
                >
                  <p className="font-medium">{item.subject}</p>
                  <p className="mt-0.5 text-[10px] text-zinc-600">{item.tag}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="p-5 md:col-span-3">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">AI Command Center</p>
                <p className="text-xs text-zinc-500">LangGraph agent · OpenRouter</p>
              </div>
              <div className="rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-1 font-mono text-[10px] text-zinc-500">
                ⌘K
              </div>
            </div>

            <div className="space-y-3">
              {conversation.slice(0, visibleLines).map((line, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                  className={`rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${
                    line.role === "user"
                      ? "ml-6 border border-white/[0.06] bg-white/[0.04] text-zinc-300"
                      : "mr-4 border border-indigo-500/20 bg-indigo-500/[0.08] text-zinc-200"
                  }`}
                >
                  <span
                    className={`mb-1 block text-[10px] font-semibold uppercase tracking-wider ${
                      line.role === "user" ? "text-zinc-500" : "text-indigo-400"
                    }`}
                  >
                    {line.role === "user" ? "You" : "MailMind"}
                  </span>
                  {line.text}
                </motion.div>
              ))}
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-black/30 px-3 py-2.5">
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
              <span className="text-xs text-zinc-500">
                Ask anything about your inbox...
              </span>
            </div>
          </div>
        </div>
      </div>

      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        className="absolute -right-4 top-12 hidden rounded-xl border border-white/[0.08] bg-[#0c0c0e] px-3 py-2 shadow-xl lg:block"
      >
        <p className="text-[10px] font-medium text-zinc-500">Response time</p>
        <p className="text-sm font-semibold text-white">1.2s</p>
      </motion.div>

      <motion.div
        animate={{ y: [0, 6, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        className="absolute -left-4 bottom-16 hidden rounded-xl border border-white/[0.08] bg-[#0c0c0e] px-3 py-2 shadow-xl lg:block"
      >
        <p className="text-[10px] font-medium text-zinc-500">Drafts saved</p>
        <p className="text-sm font-semibold text-emerald-400">3 today</p>
      </motion.div>
    </motion.div>
  );
}
