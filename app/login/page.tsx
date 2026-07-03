import Link from "next/link";
import { AnimatedBackground } from "@/components/landing/animated-background";
import { LoginForm } from "@/components/auth/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="relative min-h-screen overflow-hidden">
      <AnimatedBackground />
      <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-12">
        <LoginForm errorMessage={params.error} />
      </div>
    </div>
  );
}
