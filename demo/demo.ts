import { AllTargetsFailedError, LLMError } from '../src/contracts.js';
import type { LLMRequest, LLMResponse } from '../src/contracts.js';
import { callWithFallback, getState, resetBreakers, targetKey } from '../src/client/helpers.js';
import type { Target } from '../src/client/helpers.js';
import { createClient, loadConfig } from '../src/client/wrapper.js';
import { summarize } from '../src/app/summarizer.js';

// Destinos que no existen: conexión rechazada = error pasajero determinista y gratis.
process.env.DEAD_URL = 'http://127.0.0.1:1/v1';
process.env.DEAD_KEY = 'no-importa';

const base = loadConfig();
const config = {
  logical_models: {
    ...base.logical_models,
    solo_anthropic: [{ destination: 'curso_anthropic', model: 'fast' }],
    peticion_invalida: [
      { destination: 'curso', model: 'fast' },
      { destination: 'curso_anthropic', model: 'fast' },
    ],
    todo_caido: [
      { destination: 'muerto_a', model: 'x' },
      { destination: 'muerto_b', model: 'x' },
    ],
  },
  destinations: {
    ...base.destinations,
    muerto_a: { format: 'openai', base_url_env: 'DEAD_URL', api_key_env: 'DEAD_KEY' },
    muerto_b: { format: 'anthropic', base_url_env: 'DEAD_URL', api_key_env: 'DEAD_KEY' },
  },
};

const log = (m: string) => console.log(`   ${m}`);
const client = createClient({ config, logger: log });

const ask = (model: string, content = 'Responde solo con la palabra: hola'): LLMRequest => ({
  model,
  systemPrompt: 'Eres conciso.',
  messages: [{ role: 'user', content }],
  maxTokens: 20,
});

function show(r: LLMResponse) {
  console.log(`   ✔ destino=${r.destination} modelo=${r.model} stop=${r.stopReason} tokens=${r.inputTokens}/${r.outputTokens}`);
  console.log(`     texto: ${JSON.stringify(r.text)}`);
}

// `npm run demo -- 7` ejecuta solo el escenario 7; sin argumento, todos.
const only = process.argv[2];

async function scenario(title: string, fn: () => Promise<void>) {
  if (only && !title.startsWith(`${only}.`)) return;
  console.log(`\n=== ${title}`);
  resetBreakers();
  try {
    await fn();
  } catch (err) {
    if (err instanceof AllTargetsFailedError) console.log(`   ✖ ${err.name}: ${err.message}`);
    else if (err instanceof LLMError) console.log(`   ✖ ${err.name} kind=${err.kind} status=${err.status}: ${err.message}`);
    else throw err;
  }
}

await scenario('1. rapido: camino feliz (formato OpenAI)', async () => {
  show(await client.complete(ask('rapido')));
});

await scenario('2. potente: chaos falla con 429 y responde Anthropic (+ cooldown)', async () => {
  for (let i = 1; i <= 15; i++) {
    console.log(` intento ${i}`);
    const r = await client.complete(ask('potente'));
    show(r);
    if (r.destination !== 'curso') break; // hubo fallback
  }
  console.log(` estado de curso/chaos: ${getState(targetKey({ destination: 'curso', model: 'chaos' }))}`);
  console.log(' segunda llamada inmediata: chaos debería saltarse');
  show(await client.complete(ask('potente')));
});

await scenario('3. petición inválida (400): NO hay fallback', async () => {
  await client.complete({ ...ask('peticion_invalida'), messages: [] });
});

await scenario('4. mismo contrato desde el formato Anthropic', async () => {
  show(await client.complete(ask('solo_anthropic')));
});

await scenario('5. todos los destinos caídos: error final', async () => {
  await client.complete(ask('todo_caido'));
});

await scenario('6. resumidor (solo usa el cliente)', async () => {
  const text =
    'Un cliente LLM propio separa la aplicación de los proveedores mediante un contrato común, ' +
    'adaptadores por formato y un plan de fallbacks guiado por configuración.';
  show(await summarize(client, text));
});

await scenario('7. circuit breaker: closed → open → half-open → closed (adaptadores simulados, sin costo)', async () => {
  let calls = 0;
  // Falla las dos primeras veces y luego se "recupera".
  const flaky: Target = {
    destination: 'inestable',
    model: 'x',
    adapter: async (req) => {
      if (++calls <= 2) throw new LLMError('503 simulado', 'transient', 503);
      return { text: 'ya me recuperé', stopReason: 'end_turn', inputTokens: 1, outputTokens: 1, model: req.model };
    },
  };
  const backup: Target = {
    destination: 'respaldo',
    model: 'y',
    adapter: async (req) => ({ text: 'respaldo', stopReason: 'end_turn', inputTokens: 1, outputTokens: 1, model: req.model }),
  };
  const key = targetKey(flaky);
  const opts = { cooldownMs: 1500, logger: log };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const state = () => console.log(`   estado de ${key}: ${getState(key)}`);

  console.log(' a) falla → se abre'); show(await callWithFallback([flaky, backup], ask('x'), opts)); state();
  console.log(' b) inmediato: se evita el destino abierto'); show(await callWithFallback([flaky, backup], ask('x'), opts)); state();
  console.log(' c) tras el cooldown: half-open, la prueba falla → vuelve a abrir');
  await wait(1600); state(); show(await callWithFallback([flaky, backup], ask('x'), opts)); state();
  console.log(' d) otro cooldown: half-open, la prueba funciona → closed');
  await wait(1600); state(); show(await callWithFallback([flaky, backup], ask('x'), opts)); state();
});
