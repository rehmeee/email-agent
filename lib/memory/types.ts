import { z } from "zod";

/** Standing user instructions — separate from writing persona. */
export const agentMemoryDocumentSchema = z.object({
  do: z.array(z.string()).default([]),
  dont: z.array(z.string()).default([]),
  facts: z.array(z.string()).default([]),
});

export type AgentMemoryDocument = z.infer<typeof agentMemoryDocumentSchema>;

export const emptyAgentMemory = (): AgentMemoryDocument => ({
  do: [],
  dont: [],
  facts: [],
});

export type MemoryUpdates = {
  add_do?: string[];
  add_dont?: string[];
  add_facts?: string[];
  /** Exact or near-matching lines to drop when a preference changes. */
  remove?: string[];
};
