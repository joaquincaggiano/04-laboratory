# Plan — Cliente LLM multi-proveedor

Ver `requirements.md` para el qué. Este documento es el cómo, en orden de implementación.

## Estructura

```
config.json                       raíz, como pide el enunciado
src/
  contracts.ts                    tipos del contrato (sin proveedores) + LLMError
  adapters/
    openAI.adapter.ts             chat.completions
    anthropicAI.adapter.ts        messages.create
  client/
    helpers.ts                    callWithRetries, callWithFallback, circuit breaker (closed/open/half-open)
    wrapper.ts                    carga config, arma adaptadores, expone createClient()
  app/
    summarizer.ts                 resumidor (solo usa el cliente)
demo/
  demo.ts                         comprobaciones con salida para las capturas (npm run demo -- <n>)
spec/  docs/
```

Dependencias permitidas: `app` → `contracts`; `client` → `adapters` + `contracts`; `adapters` → `contracts`. Solo `adapters/` importa SDKs de proveedores.

## Paso 1 — `contracts.ts`

```ts
export type Role = 'user' | 'assistant';
export interface Message { role: Role; content: string }

export interface LLMRequest {
  model: string;            // modelo lógico en la app; modelo real dentro del adaptador
  systemPrompt: string;
  messages: Message[];
  maxTokens?: number;
}

export type StopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'other';

export interface LLMResponse {
  text: string;
  stopReason: StopReason;
  inputTokens: number;
  outputTokens: number;
  model: string;            // modelo real que respondió
  destination: string;      // destino que respondió
}

// El adaptador no conoce el nombre del destino: lo añade el cliente.
export type AdapterResponse = Omit<LLMResponse, 'destination'>;
export type LLMAdapter = (request: LLMRequest) => Promise<AdapterResponse>;

export class LLMError extends Error {
  constructor(
    message: string,
    public kind: 'transient' | 'request',
    public status?: number,
    options?: ErrorOptions,
  ) { super(message, options); }
}
```

> Cambios respecto al borrador: `model` y `destination` en la respuesta (el enunciado los exige), `'other'` en `stopReason` (OpenAI y Anthropic tienen más motivos), y `LLMError`.

## Paso 2 — Adaptadores

Cada uno es una fábrica `createXAdapter({ baseUrl, apiKey }): LLMAdapter`. No usan `new OpenAI()` sin argumentos: la URL y la clave vienen de las variables de entorno que nombra el config.

**`openAI.adapter.ts`**
- `new OpenAI({ baseURL, apiKey, maxRetries: 0, timeout })`.
- `chat.completions.create({ model, messages: [{role:'system', content: systemPrompt}, ...messages], max_tokens })`.
- `finish_reason`: `stop`→`end_turn`, `length`→`max_tokens`, el resto→`other`.
- Tokens: `usage.prompt_tokens` / `usage.completion_tokens`.

**`anthropicAI.adapter.ts`**
- `new Anthropic({ baseURL, apiKey, maxRetries: 0, timeout })`.
- `messages.create({ model, system: systemPrompt, messages, max_tokens: maxTokens ?? 1024 })` (`max_tokens` es obligatorio; el system va aparte, no como mensaje).
- `stop_reason`: `end_turn`, `max_tokens`, `stop_sequence` tal cual; el resto→`other`.
- Texto: concatenar los bloques `content` de tipo `text`. Tokens: `usage.input_tokens` / `usage.output_tokens`.

**Traducción de errores (en ambos)**: capturar el error del SDK y lanzar `LLMError`:
- status `429` o `>= 500` → `transient`.
- timeout o error de conexión (sin status) → `transient`.
- cualquier otro 4xx (400, 401, 403, 404, 422) → `request`.

## Paso 3 — `helpers.ts`

- `callWithRetries(fn, { retries, delayMs })`: reintenta solo si `LLMError.kind === 'transient'`; si es `request`, lanza de inmediato.
- Cooldown: `Map<string, number>` con `clave = destination:model → timestamp hasta el que está en pausa`.
  - `markFailed(key)` guarda `now + 30_000`.
  - `cooldownPassed(key)` devuelve `true` si no hay entrada o ya pasó.
- `callWithFallback(targets, request)`:
  1. Recorre los destinos en orden, saltando los que están en cooldown.
  2. Llama con `callWithRetries`.
  3. `transient` → `markFailed`, guarda el intento y pasa al siguiente.
  4. `request` → lanza ya, sin probar más.
  5. Si se agotan todos, lanza un error final con el resumen de intentos. Si todos estaban en cooldown, los intenta igual en orden.
  6. Éxito → devuelve la respuesta con `destination` añadido.

## Paso 4 — Configuración y `wrapper.ts`

`config.json` ya existe. Cómo se usa:

1. `import 'dotenv/config'` y leer el archivo: `JSON.parse(readFileSync('config.json', 'utf-8'))`. (Se prefiere esto a `import ... with { type: 'json' }` porque el config es dato, no código, y se puede cambiar sin recompilar.)
2. Definir los tipos `Config`, `Destination` y `Target`, y **validar** al cargar (RF3).
3. Mapa de fábricas por formato: `{ openai: createOpenAIAdapter, anthropic: createAnthropicAdapter }`. Es el único punto del cliente donde se nombra un formato. Añadir un formato nuevo es añadir una línea aquí.
4. Para cada destino del config: leer `process.env[base_url_env]` y `process.env[api_key_env]`, y construir su adaptador (una sola vez).
5. `createClient(config?)` devuelve `{ complete(request: LLMRequest): Promise<LLMResponse> }`:
   - busca `config.logical_models[request.model]`,
   - construye los `targets` (`{ destination, model real, adapter }`),
   - llama a `callWithFallback`, sustituyendo `request.model` por el modelo real en cada intento.

## Paso 5 — `summarizer.ts`

`summarize(text, client, model = 'rapido')` arma un `LLMRequest` con un system prompt de resumen y llama a `client.complete`. Importa solo el tipo del cliente. Se comprueba con `grep` que no hay `from 'openai'` ni `from '@anthropic-ai/sdk'` fuera de los adaptadores.

## Paso 6 — `demo.ts` y capturas

Un script que ejecuta las comprobaciones de `requirements.md` e imprime `destination`, `model`, `stopReason` y tokens de cada una:

1. `rapido`: camino feliz.
2. `potente`: `chaos` falla con 429 y responde `curso_anthropic`. Repetirlo hasta que `chaos` falle (falla al azar) y capturar un caso con fallback y otro sin.
3. Un 400 provocado (por ejemplo `maxTokens: -1` o un mensaje vacío, según lo que devuelva el servicio): no hay fallback.
4. Un modelo lógico temporal que apunte solo a `curso_anthropic`.
5. Un modelo lógico temporal con todos los destinos en `chaos`: error final.
6. `summarizer` ejecutado con un texto corto.

Capturar la terminal sin mostrar el `.env`.

## Paso 7 — Documentos y entrega

- `README.md`: el contrato y **cómo añadir un destino nuevo**:
  - mismo formato: una entrada en `destinations` y referencias en `logical_models`;
  - formato nuevo: un `xxx.adapter.ts` que cumpla `LLMAdapter` (traduciendo errores a `LLMError`) y una línea en el mapa de fábricas de `wrapper.ts`.
- `analisis.md`: las dos preguntas del enunciado, con lo que realmente pasó al implementar.
- Zip sin `.env` ni `node_modules`:
  `zip -r laboratorio-4.zip . -x ".env" "node_modules/*" ".git/*"`

## Riesgos y decisiones abiertas
- Los SDK reintentan solos los 429 y 5xx; por eso `maxRetries: 0`.
- Hay que comprobar qué devuelve el servicio del curso ante un request inválido para provocar el 400 (paso 6.3).
- `chaos` falla al azar: las pruebas del fallback pueden requerir varias ejecuciones.
