"use client";

import { motion } from "framer-motion";

export function AnimatedBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[#030304]" />
      <div className="grid-bg absolute inset-0" />

      <div className="absolute left-1/2 top-0 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-indigo-600/10 blur-[120px]" />
      <div className="absolute -left-40 top-1/4 h-[500px] w-[500px] rounded-full bg-violet-600/8 blur-[100px]" />
      <div className="absolute -right-40 bottom-0 h-[400px] w-[600px] rounded-full bg-cyan-500/6 blur-[100px]" />

      <motion.div
        className="absolute left-[15%] top-[20%] h-px w-[30%] bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent"
        animate={{ opacity: [0.2, 0.6, 0.2], scaleX: [0.8, 1, 0.8] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute right-[10%] top-[60%] h-px w-[25%] bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent"
        animate={{ opacity: [0.15, 0.5, 0.15] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
    </div>
  );
}
