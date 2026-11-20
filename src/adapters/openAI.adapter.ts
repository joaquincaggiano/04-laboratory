import OpenAI from "openai";
import { llmErrorFromStatus } from "../contracts.js";
import type { LLMAdapter, StopReason } from "../contracts.js";

export interface AdapterOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

function mapStopReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    default:
      return "other";
  }
}

export function createOpenAIAdapter({
  baseUrl,
  apiKey,
  timeoutMs = 20_000,
}: AdapterOptions): LLMAdapter {
  // maxRetries: 0 -> los reintentos los controla el cliente, no el SDK.
  const client = new OpenAI({
    baseURL: baseUrl,
    apiKey,
    maxRetries: 0,
    timeout: timeoutMs,
  });

  return async (request) => {
    try {
      const response = await client.chat.completions.create({
        model: request.model,
        messages: [
          { role: "system", content: request.systemPrompt },
          ...request.messages,
        ],
        max_tokens: request.maxTokens,
      });
      const choice = response.choices[0];
      const inputTokens = response.usage?.prompt_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;
      const totalTokens = response.usage?.total_tokens ?? 0;
      return {
        text: choice?.message.content ?? "",
        stopReason: mapStopReason(choice?.finish_reason),
        inputTokens,
        outputTokens,
        totalTokens,
        model: response.model,
      };
    } catch (err) {
      // APIError cubre respuestas HTTP; APIConnectionError (y su timeout) llega sin status.
      if (err instanceof OpenAI.APIError)
        throw llmErrorFromStatus(err.message, err.status, err);
      throw err;
    }
  };
}
