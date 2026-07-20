import {
  InMemoryStore,
  type BaseStore,
} from "@langchain/langgraph";
import {
  getAgentMemory,
  mergeMemoryDocument,
  parseMemoryDocument,
  saveAgentMemory,
} from "@/lib/memory/db";
import type { AgentMemoryDocument, MemoryUpdates } from "@/lib/memory/types";

const MEMORY_KEY = "profile";

type GlobalMemoryStore = typeof globalThis & {
  __mailmindMemoryStore?: InMemoryStore;
};

/** Process-local LangGraph Store used as a cache in front of Supabase. */
export function getMailMindMemoryStore(): InMemoryStore {
  const globalStore = globalThis as GlobalMemoryStore;
  if (!globalStore.__mailmindMemoryStore) {
    globalStore.__mailmindMemoryStore = new InMemoryStore();
  }
  return globalStore.__mailmindMemoryStore;
}

export function memoryNamespace(userId: string): string[] {
  return ["mailmind", "users", userId];
}

/**
 * Prefer an explicit store arg; otherwise use the process singleton.
 * Do NOT call LangGraph `getStore()` here — Next.js often lacks AsyncLocalStorage,
 * and bare getStore() throws instead of returning undefined.
 */
function resolveStore(store?: BaseStore | null): BaseStore {
  return store ?? getMailMindMemoryStore();
}

export type MemoryLoadResult = {
  memory: AgentMemoryDocument;
  /** Where the document was read from for this call. */
  source: "store" | "supabase";
};

/**
 * Cache-aside read: Store first, then Supabase on miss (and fill Store).
 * Supabase remains the durable source of truth.
 */
export async function getAgentMemoryCached(
  userId: string,
  store?: BaseStore | null
): Promise<MemoryLoadResult> {
  const resolved = resolveStore(store);
  const namespace = memoryNamespace(userId);

  try {
    const item = await resolved.get(namespace, MEMORY_KEY);
    if (item?.value) {
      return {
        memory: parseMemoryDocument(item.value),
        source: "store",
      };
    }
  } catch {
    // Fall through to Supabase if Store read fails.
  }

  const memory = await getAgentMemory(userId);

  try {
    await resolved.put(namespace, MEMORY_KEY, memory);
  } catch {
    // Durable read succeeded; cache fill is best-effort.
  }

  return { memory, source: "supabase" };
}

/** Write Supabase first, then mirror into Store. */
export async function saveAgentMemoryCached(
  userId: string,
  memory: AgentMemoryDocument,
  store?: BaseStore | null
): Promise<AgentMemoryDocument> {
  const saved = await saveAgentMemory(userId, memory);
  const resolved = resolveStore(store);
  const namespace = memoryNamespace(userId);

  try {
    await resolved.put(namespace, MEMORY_KEY, saved);
  } catch {
    // DB is truth; next miss will refill Store.
  }

  return saved;
}

/** Merge updates using cached current memory, then persist DB + Store. */
export async function updateAgentMemoryCached(
  userId: string,
  updates: MemoryUpdates,
  store?: BaseStore | null
): Promise<AgentMemoryDocument> {
  const { memory: current } = await getAgentMemoryCached(userId, store);
  const merged = mergeMemoryDocument(current, updates);
  return saveAgentMemoryCached(userId, merged, store);
}
