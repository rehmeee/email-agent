import {
  ChatOpenAI,
  ChatOpenAICompletions,
} from "@langchain/openai";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { OpenAI } from "openai";

type CompletionsMessage = OpenAI.Chat.ChatCompletionMessageParam;

/**
 * DeepSeek thinking mode requires `reasoning_content` to be echoed back on
 * every subsequent request when the assistant turn included tool calls.
 * LangChain's OpenAI converter stores it on `additional_kwargs` but drops it
 * when mapping messages back to the Completions API — reinject it here.
 */
function injectReasoningContent(
  mapped: CompletionsMessage[],
  original: BaseMessage[],
): CompletionsMessage[] {
  const aiMessages = original.filter((m): m is AIMessage => AIMessage.isInstance(m));
  let aiIndex = 0;

  return mapped.map((msg) => {
    if (msg.role !== "assistant") return msg;
    const ai = aiMessages[aiIndex++];
    const reasoning = ai?.additional_kwargs?.reasoning_content;
    if (typeof reasoning !== "string") return msg;
    return { ...msg, reasoning_content: reasoning } as CompletionsMessage;
  });
}

class DeepSeekCompletions extends ChatOpenAICompletions {
  #pendingMessages: BaseMessage[] | null = null;

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: Parameters<ChatOpenAICompletions["_generate"]>[2],
  ) {
    this.#pendingMessages = messages;
    try {
      return await super._generate(messages, options, runManager);
    } finally {
      this.#pendingMessages = null;
    }
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: Parameters<ChatOpenAICompletions["_streamResponseChunks"]>[2],
  ) {
    this.#pendingMessages = messages;
    try {
      yield* super._streamResponseChunks(messages, options, runManager);
    } finally {
      this.#pendingMessages = null;
    }
  }

  async *_streamChatModelEvents(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: Parameters<ChatOpenAICompletions["_streamChatModelEvents"]>[2],
  ) {
    this.#pendingMessages = messages;
    try {
      yield* super._streamChatModelEvents(messages, options, runManager);
    } finally {
      this.#pendingMessages = null;
    }
  }

  completionWithRetry(
    request: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
    requestOptions?: OpenAI.RequestOptions,
  ): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>>;
  completionWithRetry(
    request: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    requestOptions?: OpenAI.RequestOptions,
  ): Promise<OpenAI.Chat.Completions.ChatCompletion>;
  async completionWithRetry(
    request:
      | OpenAI.Chat.ChatCompletionCreateParamsStreaming
      | OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    requestOptions?: OpenAI.RequestOptions,
  ): Promise<
    | AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
    | OpenAI.Chat.Completions.ChatCompletion
  > {
    const pending = this.#pendingMessages;
    const patched =
      pending && "messages" in request && Array.isArray(request.messages)
        ? {
            ...request,
            messages: injectReasoningContent(
              request.messages as CompletionsMessage[],
              pending,
            ),
          }
        : request;

    if (patched.stream) {
      return super.completionWithRetry(
        patched as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
        requestOptions,
      );
    }
    return super.completionWithRetry(
      patched as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      requestOptions,
    );
  }
}

export function createLlm() {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const model = process.env.DEEPSEEK_MODEL?.trim() ?? "deepseek-v4-flash";
  const reasoningEffort =
    process.env.DEEPSEEK_REASONING_EFFORT?.trim() ?? "high";
  const thinkingEnabled =
    (process.env.DEEPSEEK_THINKING?.trim() ?? "enabled") !== "disabled";

  if (!apiKey) {
    throw new Error("Missing DEEPSEEK_API_KEY");
  }

  const fields = {
    model,
    apiKey,
    // Temperature is ignored in DeepSeek thinking mode; keep a mild default
    // when thinking is off.
    temperature: thinkingEnabled ? undefined : 0.2,
    configuration: {
      baseURL: "https://api.deepseek.com",
    },
    modelKwargs: {
      ...(thinkingEnabled
        ? { thinking: { type: "enabled" as const } }
        : { thinking: { type: "disabled" as const } }),
      reasoning_effort: reasoningEffort,
    },
  };

  return new ChatOpenAI({
    ...fields,
    useResponsesApi: false,
    completions: new DeepSeekCompletions(fields),
  });
}
