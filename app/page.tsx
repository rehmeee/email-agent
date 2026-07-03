import { AnimatedBackground } from "@/components/landing/animated-background";
import { LandingContent } from "@/components/landing/landing-content";
import { SignInButton } from "@/components/auth/sign-in-button";

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <AnimatedBackground />
      <LandingContent
        signInButton={<SignInButton variant="primary" label="Get started" />}
        navSignInButton={<SignInButton variant="nav" label="Sign in" />}
      />
    </div>
  );
}
