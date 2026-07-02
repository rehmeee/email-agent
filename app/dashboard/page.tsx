import { signOut } from "@/auth";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { DashboardClient } from "@/components/dashboard/dashboard-client";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const user = session.user;

  return (
    <DashboardClient
      user={{
        name: user.name ?? "User",
        email: user.email ?? "",
        image: user.image ?? null,
      }}
      signOutAction={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    />
  );
}
