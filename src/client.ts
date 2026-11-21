import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import { createAnthropicAdapter } from "./adapters/anthropicAI.adapter.js";
import { createOpenAIAdapter } from "./adapters/openAI.adapter.js";
import { LLMError } from "./contracts.js";
import type {
  LLMAdapter,
  LLMClient,
  LLMRequest,
  LLMResponse,
} from "./contracts.js";

dotenv.config({ quiet: true });

export interface Config {
  logical_models: Record<string, { destination: string; model: string }[]>;
  destinations: Record<
    string,
    { format: string; base_url_env: string; api_key_env: string }
  >;
}

const factories: Record<
  string,
  (options: { baseUrl: string; apiKey: string }) => LLMAdapter
> = {
  openai: createOpenAIAdapter,
  anthropic: createAnthropicAdapter,
};

export function loadConfig(): Config {
  return JSON.parse(
    readFileSync(new URL("../config.json", import.meta.url), "utf-8"),
  );
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

export function createClient(config: Config = loadConfig()): LLMClient {
  const adapters = new Map<string, LLMAdapter>();

  for (const [name, d] of Object.entries(config.destinations)) {
    const factory = factories[d.format];
    if (!factory)
      throw new Error(`Destino "${name}": formato desconocido "${d.format}"`);

    adapters.set(
      name,
      factory({ baseUrl: env(d.base_url_env), apiKey: env(d.api_key_env) }),
    );
  }

  return {
    async complete(request: LLMRequest): Promise<LLMResponse> {
      const targets = config.logical_models[request.model];
      if (!targets)
        throw new Error(`Modelo lógico desconocido: "${request.model}"`);

      const failures: string[] = [];
      for (const { destination, model } of targets) {
        try {
          const adapter = adapters.get(destination)!;

          const response = await adapter({
            ...request,
            model,
          });

          return { ...response, destination };
        } catch (err) {
          // Error de la petición (400...) o un bug: fallaría igual en otro destino, no se prueba el siguiente.
          if (!(err instanceof LLMError) || err.kind === "request") throw err;
          // Error pasajero (429, 5xx, timeout): siguiente destino de la lista.
          failures.push(
            `${destination}/${model} [${err.status ?? "sin status"}] ${err.message}`,
          );
        }
      }
      throw new Error(
        `Todos los destinos fallaron:\n  ${failures.join("\n  ")}`,
      );
    },
  };
}
