import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { AnimatedBackground } from "@/components/landing/animated-background";
import { LandingContent } from "@/components/landing/landing-content";
import { SignInButton } from "@/components/auth/sign-in-button";

export default async function Home() {
  const session = await auth();
  if (session) redirect("/dashboard");

  return (
    <div className="relative min-h-screen overflow-hidden">
      <AnimatedBackground />
      <LandingContent
        signInButton={<SignInButton variant="primary" />}
        navSignInButton={<SignInButton variant="nav" label="Sign in" />}
      />
    </div>
  );
}
