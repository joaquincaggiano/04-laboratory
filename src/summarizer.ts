// Solo conoce el contrato: no importa ni OpenAI ni Anthropic.
import type { LLMClient, LLMResponse } from "./contracts.js";

export function summarize(
  client: LLMClient,
  text: string,
  model = "rapido",
): Promise<LLMResponse> {
  return client.complete({
    model,
    systemPrompt:
      "Resume el texto del usuario en una o dos frases, en el mismo idioma.",
    messages: [{ role: "user", content: text }],
    maxTokens: 150,
  });
}
