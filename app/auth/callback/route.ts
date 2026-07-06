import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { saveGmailTokens } from "@/lib/gmail/connection";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";
  const gmailLink = searchParams.get("gmail") === "linked";
  const oauthError = searchParams.get("error");
  const oauthErrorDescription = searchParams.get("error_description");

  if (oauthError) {
    const isAccessDenied = oauthError === "access_denied";
    const message = isAccessDenied
      ? "Google access denied. Add your Gmail address as a test user in Google Cloud Console (OAuth consent screen → Test users), then try again."
      : oauthErrorDescription ?? `Google sign-in failed (${oauthError}).`;
    const destination = gmailLink ? next : "/login";
    const separator = destination.includes("?") ? "&" : "?";
    return NextResponse.redirect(
      `${origin}${destination}${separator}error=${encodeURIComponent(message)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("Authentication failed. Please try again.")}`
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session || !data.user) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("Authentication failed. Please try again.")}`
    );
  }

  const { session, user } = data;
  const providerToken = session.provider_token;
  const providerRefreshToken = session.provider_refresh_token;

  if (gmailLink && providerToken) {
    try {
      await saveGmailTokens(user.id, {
        accessToken: providerToken,
        refreshToken: providerRefreshToken,
        expiresIn: 3600,
        googleEmail: user.email,
      });
    } catch (saveError) {
      const message =
        saveError instanceof Error
          ? saveError.message
          : "Failed to save Gmail connection.";
      const separator = next.includes("?") ? "&" : "?";
      return NextResponse.redirect(
        `${origin}${next}${separator}error=${encodeURIComponent(message)}`
      );
    }
  } else if (gmailLink) {
    const separator = next.includes("?") ? "&" : "?";
    return NextResponse.redirect(
      `${origin}${next}${separator}error=${encodeURIComponent("Gmail authorization did not return access tokens. Enable manual identity linking in Supabase and try again.")}`
    );
  }

  const separator = next.includes("?") ? "&" : "?";
  const successParam =
    gmailLink && providerToken ? `${separator}gmail=connected` : "";

  return NextResponse.redirect(`${origin}${next}${successParam}`);
}
