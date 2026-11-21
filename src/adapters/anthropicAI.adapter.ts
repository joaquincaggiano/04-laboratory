import Anthropic from "@anthropic-ai/sdk";
import { llmErrorFromStatus } from "../contracts.js";
import type { DestinationAdapter, StopReason } from "../contracts.js";
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
}: AdapterOptions): DestinationAdapter {
  const client = new Anthropic({
    baseURL: baseUrl,
    apiKey,
    maxRetries: 0,
    timeout: timeoutMs,
  });

  const complete: DestinationAdapter["complete"] = async (request) => {
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
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        model: response.model,
      };
    } catch (err) {
      if (err instanceof Anthropic.APIError)
        throw llmErrorFromStatus(err.message, err.status, err);
      throw err;
    }
  };

  const stream: DestinationAdapter["stream"] = async function* (request) {
    try {
      const events = await client.messages.create({
        model: request.model,
        system: request.systemPrompt,
        messages: request.messages,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        stream: true,
      });

      let text = "";
      let model = request.model;
      let inputTokens = 0;
      let outputTokens = 0;
      let stopReason: string | null | undefined;

      for await (const event of events) {
        switch (event.type) {
          case "message_start":
            model = event.message.model;
            inputTokens = event.message.usage.input_tokens;
            break;
          case "content_block_delta":
            if (event.delta.type === "text_delta") {
              text += event.delta.text;
              yield { type: "delta", text: event.delta.text };
            }
            break;
          case "message_delta":
            stopReason = event.delta.stop_reason;
            outputTokens = event.usage.output_tokens;
            break;
        }
      }

      yield {
        type: "done",
        response: {
          text,
          stopReason: mapStopReason(stopReason),
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          model,
        },
      };
    } catch (err) {
      if (err instanceof Anthropic.APIError)
        throw llmErrorFromStatus(err.message, err.status, err);
      throw err;
    }
  };

  return { complete, stream };
}
