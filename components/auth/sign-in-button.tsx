import { signInWithGoogle } from "@/lib/actions/auth";

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

export function SignInButton({
  variant = "primary",
  className = "",
  label = "Get started with Google",
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
    <form action={signInWithGoogle}>
      <button
        type="submit"
        className={`inline-flex items-center justify-center gap-2.5 rounded-full transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] ${styles[variant]} ${className}`}
      >
        {variant !== "ghost" && <GoogleIcon />}
        {label}
      </button>
    </form>
  );
}
