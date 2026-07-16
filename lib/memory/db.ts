import { createAdminClient } from "@/lib/supabase/admin";
import {
  agentMemoryDocumentSchema,
  emptyAgentMemory,
  type AgentMemoryDocument,
  type MemoryUpdates,
} from "@/lib/memory/types";

function isMissingTableError(message: string) {
  return (
    message.includes("agent_memory") &&
    (message.includes("schema cache") ||
      message.includes("does not exist") ||
      message.includes("Could not find"))
  );
}

function normalizeLine(line: string) {
  return line.trim().toLowerCase().replace(/\s+/g, " ");
}

function uniquePush(list: string[], items: string[] | undefined) {
  const next = [...list];
  for (const item of items ?? []) {
    const cleaned = item.trim();
    if (!cleaned) continue;
    const key = normalizeLine(cleaned);
    if (next.some((existing) => normalizeLine(existing) === key)) continue;
    next.push(cleaned);
  }
  return next;
}

function removeLines(list: string[], removals: string[] | undefined) {
  if (!removals?.length) return list;
  const removalKeys = new Set(removals.map(normalizeLine));
  return list.filter((line) => !removalKeys.has(normalizeLine(line)));
}

export function mergeMemoryDocument(
  current: AgentMemoryDocument,
  updates: MemoryUpdates
): AgentMemoryDocument {
  let doList = removeLines(current.do, updates.remove);
  let dontList = removeLines(current.dont, updates.remove);
  let facts = removeLines(current.facts, updates.remove);

  doList = uniquePush(doList, updates.add_do);
  dontList = uniquePush(dontList, updates.add_dont);
  facts = uniquePush(facts, updates.add_facts);

  return { do: doList, dont: dontList, facts };
}

export function parseMemoryDocument(raw: unknown): AgentMemoryDocument {
  const parsed = agentMemoryDocumentSchema.safeParse(raw ?? {});
  if (!parsed.success) return emptyAgentMemory();
  return {
    do: parsed.data.do ?? [],
    dont: parsed.data.dont ?? [],
    facts: parsed.data.facts ?? [],
  };
}

/** Load the single per-user memory JSON from `agent_memory`. */
export async function getAgentMemory(
  userId: string
): Promise<AgentMemoryDocument> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("agent_memory")
    .select("memory")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error.message)) return emptyAgentMemory();
    // Old append-only schema still deployed (has `content` / no `memory` column).
    if (
      error.message.includes("memory") &&
      (error.message.includes("column") || error.message.includes("schema cache"))
    ) {
      throw new Error(
        "agent_memory still uses the old row schema. Run supabase/migrations/004_agent_memory_profile.sql in Supabase."
      );
    }
    throw new Error(`Failed to load agent memory: ${error.message}`);
  }

  return parseMemoryDocument(data?.memory);
}

export async function saveAgentMemory(
  userId: string,
  memory: AgentMemoryDocument
) {
  const admin = createAdminClient();
  const normalized = parseMemoryDocument(memory);
  const { error } = await admin.from("agent_memory").upsert(
    {
      user_id: userId,
      memory: normalized,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    if (isMissingTableError(error.message)) {
      throw new Error(
        "agent_memory table is missing. Run supabase/migrations/003_persona_feedback.sql and 004_agent_memory_profile.sql."
      );
    }
    if (
      error.message.includes("memory") &&
      (error.message.includes("column") || error.message.includes("schema cache"))
    ) {
      throw new Error(
        "agent_memory still uses the old row schema. Run supabase/migrations/004_agent_memory_profile.sql in Supabase."
      );
    }
    throw new Error(`Failed to save agent memory: ${error.message}`);
  }

  return normalized;
}

/** Merge updates into the user's single JSON memory document and persist. */
export async function updateAgentMemory(
  userId: string,
  updates: MemoryUpdates
): Promise<AgentMemoryDocument> {
  const current = await getAgentMemory(userId);
  const merged = mergeMemoryDocument(current, updates);
  return saveAgentMemory(userId, merged);
}

export function formatMemoryForPrompt(memory: AgentMemoryDocument | null | undefined) {
  const doc = memory ?? emptyAgentMemory();
  const hasAny =
    doc.do.length > 0 || doc.dont.length > 0 || doc.facts.length > 0;

  if (!hasAny) {
    return "No standing user memory yet.";
  }

  const lines: string[] = [];
  if (doc.facts.length) {
    lines.push("Facts:");
    doc.facts.forEach((item) => lines.push(`- ${item}`));
  }
  if (doc.do.length) {
    lines.push("Do:");
    doc.do.forEach((item) => lines.push(`- ${item}`));
  }
  if (doc.dont.length) {
    lines.push("Don't:");
    doc.dont.forEach((item) => lines.push(`- ${item}`));
  }
  return lines.join("\n");
}

export function summarizeMemoryUpdates(updates: MemoryUpdates): string {
  const parts: string[] = [];
  for (const item of updates.add_facts ?? []) parts.push(`fact: ${item}`);
  for (const item of updates.add_do ?? []) parts.push(`do: ${item}`);
  for (const item of updates.add_dont ?? []) parts.push(`don't: ${item}`);
  for (const item of updates.remove ?? []) parts.push(`removed: ${item}`);
  return parts.length ? parts.join("; ") : "Memory updated.";
}
