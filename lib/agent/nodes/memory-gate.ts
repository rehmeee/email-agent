import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { createLlm } from "@/lib/agent/llm";
import type { MailMindStateType } from "@/lib/agent/state";
import {
  formatMemoryForPrompt,
  getAgentMemory,
  summarizeMemoryUpdates,
  updateAgentMemory,
} from "@/lib/memory/db";
import type { MemoryUpdates } from "@/lib/memory/types";

const memoryGateSchema = z.object({
  is_useful: z.boolean(),
  confidence: z.number(),
  reason: z.string(),
  add_do: z.array(z.string()).nullable().optional(),
  add_dont: z.array(z.string()).nullable().optional(),
  add_facts: z.array(z.string()).nullable().optional(),
  remove: z
    .array(z.string())
    .nullable()
    .optional()
    .describe("Existing memory lines to remove when a preference changes"),
});

type MemoryGateResult = z.infer<typeof memoryGateSchema>;

function latestHumanText(state: MailMindStateType) {
  const lastUser = [...(state.messages ?? [])]
    .reverse()
    .find((message) => message._getType() === "human");

  if (!lastUser) return "";
  return typeof lastUser.content === "string" ? lastUser.content.trim() : "";
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1]?.trim() ?? text.trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model response");
  }
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

function toUpdates(extracted: MemoryGateResult): MemoryUpdates {
  return {
    add_do: extracted.add_do?.filter(Boolean) ?? [],
    add_dont: extracted.add_dont?.filter(Boolean) ?? [],
    add_facts: extracted.add_facts?.filter(Boolean) ?? [],
    remove: extracted.remove?.filter(Boolean) ?? [],
  };
}

function hasUpdates(updates: MemoryUpdates) {
  return Boolean(
    updates.add_do?.length ||
      updates.add_dont?.length ||
      updates.add_facts?.length ||
      updates.remove?.length
  );
}

async function classifyMemoryGate(
  userText: string,
  currentMemoryText: string
): Promise<MemoryGateResult> {
  const system = `You are MailMind's memory gate (NOT the writing persona).

Persona (how emails sound) is separate and is NOT updated here.
You only maintain standing USER MEMORY as do / dont / facts lines.

SAVE (is_useful=true) when the user sets or CHANGES lasting instructions, e.g.:
- "call me Ali" → add_facts: ["User's name is Ali; address them as Ali"]
- "keep replies short" → add_do: ["Keep replies short"]
- "never use emojis" → add_dont: ["Use emojis"]
- "don't call me Ali, call me Alex" → remove old Ali line(s), add_facts for Alex

IGNORE (is_useful=false) for one-off tasks, thanks/ok, secrets, or ephemeral chat.
Require confidence >= 0.7. Prefer short lines. Do not invent persona/tone fields.`;

  const human = `Current memory JSON (as text):
${currentMemoryText}

User message:
${userText}`;

  try {
    const structured = createLlm().withStructuredOutput(memoryGateSchema, {
      method: "jsonMode",
    });
    return await structured.invoke([
      new SystemMessage(system),
      new HumanMessage(human),
    ]);
  } catch (structuredError) {
    const llm = createLlm();
    const response = await llm.invoke([
      new SystemMessage(
        `${system}

Respond with ONLY JSON:
{
  "is_useful": boolean,
  "confidence": number,
  "reason": string,
  "add_do": string[] | null,
  "add_dont": string[] | null,
  "add_facts": string[] | null,
  "remove": string[] | null
}

Structured-output error: ${errorMessage(structuredError)}`
      ),
      new HumanMessage(human),
    ]);

    const text =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    return memoryGateSchema.parse(extractJsonObject(text));
  }
}

/**
 * Before every subgraph: if the chat message has durable user instructions,
 * merge them into the single per-user memory JSON. Never touches persona.
 */
export async function memoryGateNode(state: MailMindStateType) {
  if (state.eventType !== "chat") {
    return {
      resultMeta: { memoryGateSkipped: true, memorySaved: false },
    };
  }

  const userText = latestHumanText(state);
  if (!userText) {
    return {
      resultMeta: {
        memoryGateSkipped: true,
        memorySaved: false,
        memoryExtractReason: "empty_user_message",
      },
    };
  }

  try {
    const currentMemory = await getAgentMemory(state.userId);
    const extracted = await classifyMemoryGate(
      userText,
      formatMemoryForPrompt(currentMemory)
    );

    const updates = toUpdates(extracted);

    if (
      !extracted.is_useful ||
      extracted.confidence < 0.7 ||
      !hasUpdates(updates)
    ) {
      return {
        memoryUpdateSummary: null,
        agentMemory: currentMemory,
        resultMeta: {
          memorySaved: false,
          memoryGateSkipped: false,
          memoryExtractReason: extracted.reason,
        },
      };
    }

    const merged = await updateAgentMemory(state.userId, updates);
    const summary = summarizeMemoryUpdates(updates);

    return {
      agentMemory: merged,
      memoryUpdateSummary: summary,
      resultMeta: {
        memorySaved: true,
        memoryGateSkipped: false,
        memoryExtractReason: extracted.reason,
        memoryUpdateSummary: summary,
      },
    };
  } catch (error) {
    return {
      memoryUpdateSummary: null,
      resultMeta: {
        memorySaved: false,
        memoryGateSkipped: false,
        memoryExtractReason: "memory_gate_failed",
        memoryGateError: errorMessage(error).slice(0, 500),
      },
    };
  }
}
