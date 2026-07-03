import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { connectGmail, signOut } from "@/lib/actions/auth";
import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { getGmailConnectionStatus } from "@/lib/gmail/connection";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; gmail?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const params = await searchParams;
  const metadata = user.user_metadata ?? {};
  const gmailStatus = await getGmailConnectionStatus(user.id);

  return (
    <DashboardClient
      user={{
        name:
          (metadata.full_name as string) ??
          (metadata.name as string) ??
          user.email?.split("@")[0] ??
          "User",
        email: user.email ?? "",
        image: (metadata.avatar_url as string) ?? (metadata.picture as string) ?? null,
      }}
      gmail={{
        connected: gmailStatus.connected,
        email: gmailStatus.googleEmail,
        connectedAt: gmailStatus.connectedAt,
        setupRequired: gmailStatus.setupRequired,
      }}
      authError={params.error}
      gmailSuccess={params.gmail === "connected"}
      signOutAction={signOut}
      connectGmailAction={connectGmail}
    />
  );
}
