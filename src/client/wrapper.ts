import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import { createAnthropicAdapter } from "../adapters/anthropicAI.adapter.js";
import { createOpenAIAdapter } from "../adapters/openAI.adapter.js";
import type { AdapterOptions } from "../adapters/openAI.adapter.js";
import { callWithFallback } from "./helpers.js";
import type { FallbackOptions, Target } from "./helpers.js";
import type { LLMAdapter, LLMClient, LLMRequest } from "../contracts.js";

dotenv.config({ quiet: true });

// ------------------------------------------------------------------- config

export interface DestinationConfig {
  format: string;
  base_url_env: string;
  api_key_env: string;
}

export interface Config {
  logical_models: Record<string, { destination: string; model: string }[]>;
  destinations: Record<string, DestinationConfig>;
}

const adapterFactories: Record<
  string,
  (options: AdapterOptions) => LLMAdapter
> = {
  openai: createOpenAIAdapter,
  anthropic: createAnthropicAdapter,
};

export function loadConfig(
  path: URL = new URL("../../config.json", import.meta.url),
): Config {
  return JSON.parse(readFileSync(path, "utf-8")) as Config;
}

function validateConfig(config: Config): void {
  for (const [name, dest] of Object.entries(config.destinations)) {
    if (!(dest.format in adapterFactories)) {
      throw new Error(
        `Destino "${name}": formato desconocido "${dest.format}" (disponibles: ${Object.keys(adapterFactories).join(", ")})`,
      );
    }
  }
  for (const [logical, targets] of Object.entries(config.logical_models)) {
    if (targets.length === 0)
      throw new Error(`Modelo lógico "${logical}": lista de destinos vacía`);
    for (const t of targets) {
      if (!(t.destination in config.destinations)) {
        throw new Error(
          `Modelo lógico "${logical}": el destino "${t.destination}" no existe en "destinations"`,
        );
      }
    }
  }
}

function requireEnv(name: string, destination: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `Destino "${destination}": falta la variable de entorno ${name}`,
    );
  return value;
}

// ------------------------------------------------------------------- cliente

export interface ClientOptions extends FallbackOptions {
  config?: Config;
}

export function createClient({
  config = loadConfig(),
  ...fallbackOptions
}: ClientOptions = {}): LLMClient {
  validateConfig(config);

  // Un adaptador por destino, solo para los destinos que algún modelo lógico usa.
  const used = new Set(
    Object.values(config.logical_models).flatMap((ts) =>
      ts.map((t) => t.destination),
    ),
  );
  const adapters = new Map<string, LLMAdapter>();
  for (const name of used) {
    const dest = config.destinations[name]!;
    adapters.set(
      name,
      adapterFactories[dest.format]!({
        baseUrl: requireEnv(dest.base_url_env, name),
        apiKey: requireEnv(dest.api_key_env, name),
      }),
    );
  }

  return {
    complete(request: LLMRequest) {
      const entries = config.logical_models[request.model];
      if (!entries) {
        throw new Error(
          `Modelo lógico desconocido "${request.model}" (disponibles: ${Object.keys(config.logical_models).join(", ")})`,
        );
      }
      const targets: Target[] = entries.map((e) => ({
        destination: e.destination,
        model: e.model,
        adapter: adapters.get(e.destination)!,
      }));
      return callWithFallback(targets, request, fallbackOptions);
    },
  };
}
