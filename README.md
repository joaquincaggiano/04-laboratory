# Laboratorio 4 — Cliente LLM multi-proveedor

Cliente propio que pide texto a un **modelo lógico** (`rapido`, `potente`) sin que la aplicación sepa qué proveedor responde. Si un destino falla con un error pasajero, prueba el siguiente de la lista.

## Estructura

```
config.json                     modelos lógicos y destinos
src/
  contracts.ts                  el contrato (tipos + LLMError)
  adapters/
    openAI.adapter.ts           formato OpenAI (chat.completions)
    anthropicAI.adapter.ts      formato Anthropic (messages.create)
  client.ts                     lee config.json y aplica el plan de fallbacks
  summarizer.ts                 resumidor: solo usa el cliente
demo.ts                         las comprobaciones
```

## Cómo ejecutarlo

```bash
npm install
# crear .env con OPENAI_API_KEY, OPENAI_BASE_URL, ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL
npm run demo        # todas las comprobaciones
npm run demo -- 3   # solo la comprobación 3
```

> Las comprobaciones 1, 2, 4 y 6 llaman a `fast` y consumen presupuesto. La 3 y la 5 no gastan.

## El contrato

La aplicación solo conoce estos tipos (`src/contracts.ts`). Ninguno menciona a un proveedor.

```ts
interface LLMRequest {
  model: string;            // modelo lógico: "rapido", "potente"
  systemPrompt: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens?: number;
}

interface LLMResponse {
  text: string;
  stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'other';
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model: string;            // modelo real que respondió
  destination: string;      // destino que respondió (clave de config.json)
}

interface LLMClient {
  complete(request: LLMRequest): Promise<LLMResponse>;
}

// Un adaptador traduce entre el contrato y una API concreta.
type LLMAdapter = (request: LLMRequest) => Promise<Omit<LLMResponse, 'destination'>>;
```

### Errores y fallbacks

Los adaptadores convierten los errores del SDK en un `LLMError` con `kind`:

| `kind` | Cuándo | Qué hace el cliente |
|---|---|---|
| `transient` | 429, 5xx, 408, timeout o error de conexión | prueba el siguiente destino |
| `request` | cualquier otro 4xx (p. ej. 400) | lanza el error, no prueba otro destino |

Si todos los destinos fallan, el cliente lanza un error con el resumen de los intentos.

## Configuración (`config.json`)

```json
{
  "logical_models": {
    "potente": [
      { "destination": "curso", "model": "chaos" },
      { "destination": "curso_anthropic", "model": "fast" }
    ]
  },
  "destinations": {
    "curso": { "format": "openai", "base_url_env": "OPENAI_BASE_URL", "api_key_env": "OPENAI_API_KEY" }
  }
}
```

- `logical_models`: cada modelo lógico tiene una lista **ordenada** de `{ destination, model }`.
- `destinations`: cada destino indica su `format` y los **nombres** de las variables de entorno con la URL y la clave. Las claves nunca van en el archivo.

## Cómo añadir un destino nuevo

**Con un formato que ya existe (`openai` o `anthropic`)**: solo configuración, sin tocar código.

1. Añadir las variables al `.env` (por ejemplo `OTRO_BASE_URL` y `OTRO_API_KEY`).
2. Añadir el destino en `destinations`:
   ```json
   "otro": { "format": "openai", "base_url_env": "OTRO_BASE_URL", "api_key_env": "OTRO_API_KEY" }
   ```
3. Usarlo en la lista de algún modelo lógico: `{ "destination": "otro", "model": "nombre-real" }`.

**Con un formato nuevo (por ejemplo `gemini`)**: además hace falta un adaptador.

1. Crear `src/adapters/gemini.adapter.ts` con una función `createGeminiAdapter({ baseUrl, apiKey }): LLMAdapter` que:
   - traduzca `LLMRequest` a la API y devuelva `text`, `stopReason`, `inputTokens`, `outputTokens`, `totalTokens` y `model`;
   - capture los errores del SDK y lance `llmErrorFromStatus(message, status, err)`;
   - cree el SDK con reintentos propios desactivados (`maxRetries: 0`), para que el fallback sea del cliente.
2. Registrarlo en `src/client.ts`, en el mapa `factories`:
   ```ts
   const factories = { openai: ..., anthropic: ..., gemini: createGeminiAdapter };
   ```
3. Añadir el destino en `config.json` con `"format": "gemini"`.

El resto del cliente y el resumidor no cambian.
