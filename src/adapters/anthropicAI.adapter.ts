import Anthropic from "@anthropic-ai/sdk";
import { llmErrorFromStatus } from "../contracts.js";
import type { LLMAdapter, StopReason } from "../contracts.js";
import type { AdapterOptions } from "./openAI.adapter.js";

const DEFAULT_MAX_TOKENS = 1024; // en Anthropic max_tokens es obligatorio

function mapStopReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case "end_turn":
    case "max_tokens":
    case "stop_sequence":
      return reason;
    default:
      return "other";
  }
}

export function createAnthropicAdapter({
  baseUrl,
  apiKey,
  timeoutMs = 20_000,
}: AdapterOptions): LLMAdapter {
  const client = new Anthropic({
    baseURL: baseUrl,
    apiKey,
    maxRetries: 0,
    timeout: timeoutMs,
  });

  return async (request) => {
    try {
      const response = await client.messages.create({
        model: request.model,
        system: request.systemPrompt,
        messages: request.messages,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      });
      return {
        text: response.content
          .map((block) => (block.type === "text" ? block.text : ""))
          .join(""),
        stopReason: mapStopReason(response.stop_reason),
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        model: response.model,
      };
    } catch (err) {
      if (err instanceof Anthropic.APIError)
        throw llmErrorFromStatus(err.message, err.status, err);
      throw err;
    }
  };
}
