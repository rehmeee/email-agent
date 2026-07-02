"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui/logo";
import { ProductPreview } from "@/components/landing/product-preview";

const navLinks = ["Features", "How it works", "Security"];

const bentoFeatures = [
  {
    title: "Natural language inbox",
    desc: "Query your mail like you'd ask a colleague. No filters, no syntax.",
    span: "md:col-span-2",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
      </svg>
    ),
  },
  {
    title: "Context memory",
    desc: "LangGraph state keeps thread context across every turn.",
    span: "md:col-span-1",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    title: "Draft engine",
    desc: "AI writes replies in your voice. You approve before anything sends.",
    span: "md:col-span-1",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    ),
  },
  {
    title: "Gmail-native",
    desc: "Secure OAuth. Reads and drafts via official Gmail API — not screen scraping.",
    span: "md:col-span-2",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
  },
];

const steps = [
  { num: "01", title: "Connect Gmail", desc: "One-click Google OAuth with least-privilege scopes." },
  { num: "02", title: "Ask in plain English", desc: "\"Show today's emails\" or \"draft a reply to Sarah.\"" },
  { num: "03", title: "Review & send", desc: "Agent drafts. You stay in control of every send." },
];

const logos = ["LangGraph", "OpenRouter", "Gmail API", "Next.js"];

export function LandingContent({
  signInButton,
  navSignInButton,
}: {
  signInButton: ReactNode;
  navSignInButton: ReactNode;
}) {
  return (
    <div className="relative z-10">
      {/* Navbar */}
      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="sticky top-0 z-50 border-b border-white/[0.04] bg-[#030304]/80 backdrop-blur-xl"
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-8">
          <Logo />
          <nav className="hidden items-center gap-8 md:flex">
            {navLinks.map((link) => (
              <a
                key={link}
                href={`#${link.toLowerCase().replace(/ /g, "-")}`}
                className="text-sm text-zinc-400 transition hover:text-white"
              >
                {link}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            {navSignInButton}
          </div>
        </div>
      </motion.header>

      {/* Hero */}
      <section className="mx-auto max-w-7xl px-6 pb-24 pt-16 lg:px-8 lg:pt-24">
        <div className="grid items-center gap-16 lg:grid-cols-2 lg:gap-12">
          <div>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mb-6 inline-flex items-center gap-2.5 rounded-full border border-indigo-500/20 bg-indigo-500/[0.08] px-4 py-1.5"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-indigo-400" />
              </span>
              <span className="text-xs font-medium text-indigo-300">
                AI-native email workspace
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="font-[family-name:var(--font-display)] text-5xl font-bold leading-[1.08] tracking-tight lg:text-6xl xl:text-7xl"
            >
              <span className="text-gradient">The inbox</span>
              <br />
              <span className="text-white">that thinks</span>
              <br />
              <span className="text-gradient-accent">with you.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="mt-6 max-w-lg text-lg leading-relaxed text-zinc-400"
            >
              MailMind is an AI email agent that searches your inbox, surfaces
              what matters, and drafts replies — powered by LangGraph and your
              Gmail.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center"
            >
              {signInButton}
              <a
                href="#features"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-6 py-3.5 text-sm font-medium text-zinc-300 transition hover:border-white/[0.15] hover:bg-white/[0.06] hover:text-white"
              >
                See how it works
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </a>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-2"
            >
              {logos.map((name) => (
                <span
                  key={name}
                  className="text-xs font-medium uppercase tracking-widest text-zinc-600"
                >
                  {name}
                </span>
              ))}
            </motion.div>
          </div>

          <ProductPreview />
        </div>
      </section>

      <div className="glow-line mx-auto max-w-4xl" />

      {/* Bento features */}
      <section id="features" className="mx-auto max-w-7xl px-6 py-24 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-14 text-center"
        >
          <p className="text-sm font-semibold uppercase tracking-widest text-indigo-400">
            Features
          </p>
          <h2 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-bold text-white md:text-4xl">
            Everything you need to run email on autopilot
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-zinc-500">
            Built for founders, operators, and anyone drowning in threads.
          </p>
        </motion.div>

        <div className="grid gap-4 md:grid-cols-3">
          {bentoFeatures.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08, duration: 0.5 }}
              className={`group glass-panel rounded-2xl p-7 transition hover:border-white/[0.12] hover:bg-white/[0.05] ${feature.span}`}
            >
              <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-400 transition group-hover:border-indigo-500/40 group-hover:bg-indigo-500/15">
                {feature.icon}
              </div>
              <h3 className="text-lg font-semibold text-white">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-500 group-hover:text-zinc-400">
                {feature.desc}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="mx-auto max-w-7xl px-6 py-24 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-14 text-center"
        >
          <p className="text-sm font-semibold uppercase tracking-widest text-cyan-400">
            How it works
          </p>
          <h2 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-bold text-white md:text-4xl">
            Up and running in minutes
          </h2>
        </motion.div>

        <div className="grid gap-6 md:grid-cols-3">
          {steps.map((step, i) => (
            <motion.div
              key={step.num}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="relative glass-panel rounded-2xl p-8"
            >
              <span className="font-mono text-4xl font-bold text-white/[0.06]">
                {step.num}
              </span>
              <h3 className="mt-2 text-lg font-semibold text-white">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-500">{step.desc}</p>
              {i < steps.length - 1 && (
                <div className="absolute -right-3 top-1/2 hidden h-px w-6 bg-gradient-to-r from-white/10 to-transparent md:block" />
              )}
            </motion.div>
          ))}
        </div>
      </section>

      {/* Security */}
      <section id="security" className="mx-auto max-w-7xl px-6 pb-24 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="glass-panel overflow-hidden rounded-3xl"
        >
          <div className="grid md:grid-cols-2">
            <div className="p-10 lg:p-14">
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-400">
                Security
              </p>
              <h2 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-bold text-white">
                Your mail stays yours
              </h2>
              <p className="mt-4 text-zinc-500 leading-relaxed">
                OAuth tokens are stored server-side. We request minimal Gmail
                scopes. Drafts never send without your explicit approval.
              </p>
              <ul className="mt-8 space-y-3">
                {[
                  "Official Gmail API — no password storage",
                  "Least-privilege OAuth scopes",
                  "Server-side token encryption",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-sm text-zinc-400">
                    <svg className="h-4 w-4 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="relative flex items-center justify-center border-t border-white/[0.06] bg-black/20 p-10 md:border-l md:border-t-0">
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-emerald-500/10 blur-3xl animate-pulse-glow" />
                <div className="relative flex h-32 w-32 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/[0.06]">
                  <svg className="h-14 w-14 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-6 pb-24 lg:px-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="relative overflow-hidden rounded-3xl border border-indigo-500/20 bg-gradient-to-br from-indigo-600/20 via-violet-600/10 to-cyan-600/10 px-8 py-16 text-center md:px-16"
        >
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.15),transparent_70%)]" />
          <div className="relative">
            <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold text-white md:text-4xl">
              Ready to reclaim your inbox?
            </h2>
            <p className="mx-auto mt-4 max-w-md text-zinc-400">
              Sign in with Google and start building your AI email workflow today.
            </p>
            <div className="mt-8 flex justify-center">{signInButton}</div>
          </div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.04] py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 md:flex-row lg:px-8">
          <Logo size="sm" />
          <p className="text-xs text-zinc-600">
            © {new Date().getFullYear()} MailMind. Built with LangGraph & Next.js.
          </p>
        </div>
      </footer>
    </div>
  );
}
