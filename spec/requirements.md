# Requirements — Cliente LLM multi-proveedor (Laboratorio 4)

## Objetivo

Un cliente propio que la aplicación (el resumidor) usa para pedir texto a un **modelo lógico** (`rapido`, `potente`), sin saber qué proveedor responde. Si un destino falla de forma pasajera, el cliente prueba el siguiente.

## Requisitos funcionales

### RF1 — Contrato propio (`contracts.ts`)
- La app pide un modelo **lógico**, nunca un modelo de proveedor.
- La respuesta siempre tiene la misma forma: `text`, `stopReason`, `inputTokens`, `outputTokens`, `model` (modelo real que respondió) y `destination` (destino que respondió).
- Ningún tipo del contrato menciona OpenAI ni Anthropic.
- `stopReason` es una unión propia: `'end_turn' | 'max_tokens' | 'stop_sequence' | 'other'`.
- El contrato define un error propio (`LLMError`) con `status?` y `kind: 'transient' | 'request'`, para que el cliente decida el fallback sin conocer errores de SDK.

### RF2 — Un adaptador por formato
- `openAI.adapter.ts`: usa `client.chat.completions.create`.
- `anthropicAI.adapter.ts`: usa `client.messages.create` (Messages API; la *Responses API* es de OpenAI, no de Anthropic).
- Cada adaptador traduce contrato ↔ API y **traduce los errores del SDK a `LLMError`**.
- Es el único lugar donde se nota la diferencia entre proveedores (system prompt, `max_tokens` obligatorio en Anthropic, nombres de campos, motivos de parada).

### RF3 — Configuración manda (`config.json`)
- `logical_models`: cada modelo lógico → lista **ordenada** de `{ destination, model }`.
- `destinations`: cada destino → `format` (`openai` | `anthropic`), `base_url_env`, `api_key_env` (nombres de variables de entorno, nunca valores).
- Añadir un destino o cambiar el orden de fallback no requiere tocar código del cliente (solo un adaptador nuevo si el formato es nuevo).
- Validar el config al cargarlo: modelo lógico inexistente, destino inexistente, formato desconocido o variable de entorno ausente dan un error claro.

### RF4 — Plan de fallbacks (`helpers.ts`)
- Error pasajero (`429`, `5xx`, timeout, error de conexión) → probar el siguiente destino de la lista.
- Error de petición (`400`, y en general 4xx salvo 429) → **no** hacer fallback; se propaga al llamador.
- Si todos los destinos fallan, error final que resume los intentos (destino, modelo, causa).
- `callWithRetries`: reintentos acotados sobre un mismo destino ante errores pasajeros (configurable; por defecto 0 para que el fallback sea visible en las pruebas).
- Cooldown: un destino que falló de forma pasajera se salta durante 30 s (`cooldownPassed`). Si todos están en cooldown, se intenta igual en orden.

### RF5 — Resumidor
- Pequeña app que resume un texto usando **solo** el cliente.
- No importa `openai` ni `@anthropic-ai/sdk` directamente.

## Requisitos no funcionales
- TypeScript estricto, ESM (como ya está el proyecto), ejecución con `tsx`.
- Las claves salen del `.env` vía `dotenv`; nunca en código, config ni capturas.
- Los SDK se crean con `maxRetries: 0` y un `timeout` explícito: el control de reintentos es del cliente, no del SDK (si no, el SDK reintenta los 429 por su cuenta y esconde el fallback).
- Las pruebas de fallo usan `chaos` (gratis). `fast` y `smart` consumen presupuesto: pocas llamadas.

## Comprobaciones (cada una con captura donde se vea el destino que respondió)
1. `rapido` responde por `curso` / `fast` (camino feliz, formato OpenAI).
2. `potente` con `chaos` falla con 429 y responde `curso_anthropic` / `fast` (fallback real).
3. Una petición inválida (400) **no** activa el fallback y falla de inmediato.
4. Un destino directo en formato Anthropic responde con el mismo contrato (misma forma de respuesta).
5. Todos los destinos fallan → error final claro.
6. El resumidor funciona sin importar ningún SDK.

## Entregable (.zip)
- Código: `contracts.ts`, `helpers.ts`, `wrapper.ts`, los dos adaptadores y el resumidor.
- `config.json`.
- `README.md` breve: el contrato y cómo se añade un destino nuevo.
- Capturas de cada comprobación.
- `analisis.md`:
  1. Qué hubo que cambiar fuera del adaptador y la config al añadir Anthropic; si fue algo, qué mejorar del contrato.
  2. Por qué un 400 no debe activar el fallback.
- **Excluir** `.env`, `node_modules` y `.venv` del zip. Sin claves visibles en ningún sitio.

## Fuera de alcance
- `validation.md` (ejercicio de prueba).
- Streaming, tool use, conversaciones multi-turno complejas.
