// Solo conoce el contrato: no importa ni OpenAI ni Anthropic.
import type {
  LLMClient,
  LLMRequest,
  LLMResponse,
  StreamEvent,
} from "./contracts.js";

const summaryRequest = (text: string, model: string): LLMRequest => ({
  model,
  systemPrompt:
    "Resume el texto del usuario en una o dos frases, en el mismo idioma.",
  messages: [{ role: "user", content: text }],
  maxTokens: 150,
});

export function summarize(
  client: LLMClient,
  text: string,
  model = "rapido",
): Promise<LLMResponse> {
  return client.complete(summaryRequest(text, model));
}

/** Igual que summarize, pero entrega el resumen por fragmentos a medida que llega. */
export function summarizeStream(
  client: LLMClient,
  text: string,
  model = "rapido",
): AsyncIterable<StreamEvent> {
  return client.stream(summaryRequest(text, model));
}
