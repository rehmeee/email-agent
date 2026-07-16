import { createAdminClient } from "@/lib/supabase/admin";
import type { PersonaProfile, PersonaRecord, PersonaStatus } from "@/lib/persona/types";

function isMissingTableError(message: string) {
  return (
    message.includes("persona_profiles") &&
    (message.includes("schema cache") ||
      message.includes("does not exist") ||
      message.includes("Could not find"))
  );
}

function mapRow(row: {
  user_id: string;
  profile: PersonaProfile | Record<string, unknown>;
  source_sample_count: number;
  status: PersonaStatus;
  error_message: string | null;
  updated_at: string;
}): PersonaRecord {
  return {
    userId: row.user_id,
    profile: row.profile ?? {},
    sourceSampleCount: row.source_sample_count ?? 0,
    status: row.status,
    errorMessage: row.error_message,
    updatedAt: row.updated_at,
  };
}

export async function getPersonaProfile(userId: string): Promise<PersonaRecord | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("persona_profiles")
    .select("user_id, profile, source_sample_count, status, error_message, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error.message)) return null;
    throw new Error(`Failed to load persona: ${error.message}`);
  }

  return data ? mapRow(data) : null;
}

export async function setPersonaBuilding(userId: string) {
  const admin = createAdminClient();
  const { error } = await admin.from("persona_profiles").upsert(
    {
      user_id: userId,
      status: "building",
      error_message: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    if (isMissingTableError(error.message)) {
      throw new Error(
        "Persona tables are missing. Run supabase/migrations/003_persona_feedback.sql in Supabase."
      );
    }
    throw new Error(`Failed to set persona building: ${error.message}`);
  }
}

export async function savePersonaProfile(input: {
  userId: string;
  profile: PersonaProfile;
  sourceSampleCount: number;
  status?: PersonaStatus;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("persona_profiles").upsert(
    {
      user_id: input.userId,
      profile: input.profile,
      source_sample_count: input.sourceSampleCount,
      status: input.status ?? "ready",
      error_message: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    throw new Error(`Failed to save persona: ${error.message}`);
  }
}

export async function markPersonaFailed(userId: string, errorMessage: string) {
  const admin = createAdminClient();
  const { error } = await admin.from("persona_profiles").upsert(
    {
      user_id: userId,
      status: "failed",
      error_message: errorMessage.slice(0, 500),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error && !isMissingTableError(error.message)) {
    throw new Error(`Failed to mark persona failed: ${error.message}`);
  }
}

export async function updatePersonaProfile(
  userId: string,
  profile: PersonaProfile | Record<string, unknown>
) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("persona_profiles")
    .update({
      profile,
      status: "ready",
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to update persona: ${error.message}`);
  }
}
