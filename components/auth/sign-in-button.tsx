import Link from "next/link";

export function SignInButton({
  variant = "primary",
  className = "",
  label = "Get started",
}: {
  variant?: "primary" | "ghost" | "nav";
  className?: string;
  label?: string;
}) {
  const styles = {
    primary:
      "bg-white text-zinc-900 hover:bg-zinc-100 shadow-lg shadow-white/10 px-7 py-3.5 text-sm font-semibold",
    ghost:
      "border border-white/[0.1] bg-white/[0.04] text-white hover:bg-white/[0.08] hover:border-white/[0.18] px-7 py-3.5 text-sm font-medium",
    nav: "border border-white/[0.08] bg-white/[0.04] text-zinc-300 hover:text-white hover:bg-white/[0.08] px-4 py-2 text-sm font-medium",
  };

  return (
    <Link
      href="/login"
      className={`inline-flex items-center justify-center gap-2.5 rounded-full transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] ${styles[variant]} ${className}`}
    >
      {label}
    </Link>
  );
}
