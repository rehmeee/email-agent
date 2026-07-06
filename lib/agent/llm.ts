import { ChatOpenAI } from "@langchain/openai";
import { getAppUrl } from "@/lib/supabase/env";

export function createLlm() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model = process.env.OPENROUTER_MODEL?.trim() ?? "openai/gpt-4o-mini";

  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY");
  }

  return new ChatOpenAI({
    model,
    apiKey,
    temperature: 0.2,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": getAppUrl(),
        "X-Title": "MailMind",
      },
    },
  });
}
