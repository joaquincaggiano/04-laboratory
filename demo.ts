import { LLMError } from "./src/contracts.js";
import type { LLMRequest, LLMResponse } from "./src/contracts.js";
import { createClient, loadConfig } from "./src/client.js";
import { summarize } from "./src/summarizer.js";

// Destino que no existe: conexión rechazada = error pasajero gratis y determinista.
process.env.DEAD_URL = "http://127.0.0.1:1/v1";
process.env.DEAD_KEY = "no-importa";

const base = loadConfig();
const client = createClient({
  logical_models: {
    ...base.logical_models,
    solo_anthropic: [{ destination: "curso_anthropic", model: "fast" }],
    peticion_invalida: [
      { destination: "curso", model: "fast" },
      { destination: "curso_anthropic", model: "fast" },
    ],
    todo_caido: [
      { destination: "muerto_a", model: "x" },
      { destination: "muerto_b", model: "x" },
    ],
  },
  destinations: {
    ...base.destinations,
    muerto_a: {
      format: "openai",
      base_url_env: "DEAD_URL",
      api_key_env: "DEAD_KEY",
    },
    muerto_b: {
      format: "anthropic",
      base_url_env: "DEAD_URL",
      api_key_env: "DEAD_KEY",
    },
  },
});

const ask = (model: string): LLMRequest => ({
  model,
  systemPrompt: "Eres conciso.",
  messages: [{ role: "user", content: "Responde solo con la palabra: hola" }],
  maxTokens: 20,
});

function show(r: LLMResponse) {
  console.log(
    `   ✔ destino=${r.destination} modelo=${r.model} stop=${r.stopReason} tokens=${r.inputTokens}+${r.outputTokens}=${r.totalTokens}`,
  );
  console.log(`     texto: ${r.text}`);
}

// `npm run demo -- 3` ejecuta solo la comprobación 3; sin argumento, todas.
const only = process.argv[2];

async function check(title: string, fn: () => Promise<void>) {
  if (only && !title.startsWith(`${only}.`)) return;
  console.log(`\n=== ${title}`);
  try {
    await fn();
  } catch (err) {
    const detail =
      err instanceof LLMError
        ? ` (kind=${err.kind}, status=${err.status})`
        : "";
    console.log(`   ✖ ${(err as Error).message}${detail}`);
  }
}

await check("1. rapido: responde el destino OpenAI", async () => {
  show(await client.complete(ask("rapido")));
});

await check(
  "2. potente: chaos falla (429) y responde el plan B (Anthropic)",
  async () => {
    for (let i = 1; i <= 15; i++) {
      const r = await client.complete(ask("potente"));
      console.log(` intento ${i}: respondió ${r.destination}`);
      if (r.destination !== "curso") return show(r);
    }
    console.log("   chaos no falló en 15 intentos, repite la prueba");
  },
);

await check(
  "3. petición inválida (400): NO se prueba el siguiente destino",
  async () => {
    await client.complete({ ...ask("peticion_invalida"), messages: [] });
  },
);

await check("4. mismo contrato desde el formato Anthropic", async () => {
  show(await client.complete(ask("solo_anthropic")));
});

await check("5. todos los destinos caídos: error final", async () => {
  await client.complete(ask("todo_caido"));
});

await check("6. resumidor (solo usa el cliente)", async () => {
  show(
    await summarize(
      client,
      "Un cliente LLM propio separa la aplicación de los proveedores mediante un contrato común, adaptadores por formato y un plan de fallbacks guiado por configuración.",
    ),
  );
});
