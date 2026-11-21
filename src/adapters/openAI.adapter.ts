import OpenAI from "openai";
import { llmErrorFromStatus } from "../contracts.js";
import type { DestinationAdapter, StopReason } from "../contracts.js";

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
}: AdapterOptions): DestinationAdapter {
  // maxRetries: 0 -> los reintentos los controla el cliente, no el SDK.
  const client = new OpenAI({
    baseURL: baseUrl,
    apiKey,
    maxRetries: 0,
    timeout: timeoutMs,
  });

  const complete: DestinationAdapter["complete"] = async (request) => {
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

  const stream: DestinationAdapter["stream"] = async function* (request) {
    try {
      const events = await client.chat.completions.create({
        model: request.model,
        messages: [
          { role: "system", content: request.systemPrompt },
          ...request.messages,
        ],
        max_tokens: request.maxTokens,
        stream: true,
        stream_options: { include_usage: true }, // sin esto no llega `usage`
      });

      let text = "";
      let model = request.model;
      let finishReason: string | null | undefined;
      let usage: { prompt: number; completion: number; total: number } = {
        prompt: 0,
        completion: 0,
        total: 0,
      };

      for await (const chunk of events) {
        model = chunk.model ?? model;
        const choice = chunk.choices[0];
        const delta = choice?.delta.content;
        if (delta) {
          text += delta;
          yield { type: "delta", text: delta };
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        // El chunk con usage llega al final, con `choices` vacío.
        if (chunk.usage)
          usage = {
            prompt: chunk.usage.prompt_tokens,
            completion: chunk.usage.completion_tokens,
            total: chunk.usage.total_tokens,
          };
      }

      yield {
        type: "done",
        response: {
          text,
          stopReason: mapStopReason(finishReason),
          inputTokens: usage.prompt,
          outputTokens: usage.completion,
          totalTokens: usage.total,
          model,
        },
      };
    } catch (err) {
      if (err instanceof OpenAI.APIError)
        throw llmErrorFromStatus(err.message, err.status, err);
      throw err;
    }
  };

  return { complete, stream };
}
