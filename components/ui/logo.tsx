export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizes = {
    sm: { box: "h-8 w-8", text: "text-sm", label: "text-sm" },
    md: { box: "h-9 w-9", text: "text-sm", label: "text-base" },
    lg: { box: "h-11 w-11", text: "text-base", label: "text-lg" },
  };
  const s = sizes[size];

  return (
    <div className="flex items-center gap-2.5">
      <div
        className={`${s.box} relative flex items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-indigo-500 via-violet-600 to-cyan-500 shadow-lg shadow-indigo-500/20`}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.35),transparent_50%)]" />
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className={`${s.text} relative text-white`}
          aria-hidden="true"
        >
          <path
            d="M4 6.5L12 3l8 3.5v11L12 21l-8-3.5v-11z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="M12 3v18M4 6.5l8 4.5 8-4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <span className={`${s.label} font-semibold tracking-tight text-white`}>
        MailMind
      </span>
    </div>
  );
}
