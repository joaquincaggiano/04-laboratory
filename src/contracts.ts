export type Role = "user" | "assistant";

export interface Message {
  role: Role;
  content: string;
}

export interface LLMRequest {
  model: string;
  systemPrompt: string;
  messages: Message[];
  maxTokens?: number;
}

export type StopReason = "end_turn" | "max_tokens" | "stop_sequence" | "other";

export interface LLMResponse {
  text: string;
  stopReason: StopReason;
  inputTokens: number;
  outputTokens: number;
  model: string;
  /** Destino (clave de config.json) que respondió. */
  destination: string;
}

/** Lo que devuelve un adaptador: el destino lo añade el cliente, el adaptador no lo conoce. */
export type AdapterResponse = Omit<LLMResponse, "destination">;

export type LLMAdapter = (request: LLMRequest) => Promise<AdapterResponse>;

/** Lo único que necesita la aplicación (p. ej. el resumidor). */
export interface LLMClient {
  complete(request: LLMRequest): Promise<LLMResponse>;
}

// ---------------------------------------------------------------- errores

/**
 * - transient: puede funcionar en otro destino o más tarde (429, 5xx, timeout, conexión).
 * - request:   la petición está mal (400, 401, 404, 422...); fallaría igual en cualquier destino.
 */
export type ErrorKind = "transient" | "request";

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly kind: ErrorKind,
    public readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LLMError";
  }
}

/** Clasificación común a todos los adaptadores. Sin status = timeout / error de conexión. */
export function llmErrorFromStatus(
  message: string,
  status: number | undefined,
  cause?: unknown,
): LLMError {
  const transient =
    status === undefined || status === 408 || status === 429 || status >= 500;
  return new LLMError(message, transient ? "transient" : "request", status, {
    cause,
  });
}

export interface Attempt {
  destination: string;
  model: string;
  status?: number;
  message: string;
}

export class AllTargetsFailedError extends Error {
  constructor(public readonly attempts: Attempt[]) {
    super(
      `Todos los destinos fallaron:\n` +
        attempts
          .map(
            (a) =>
              `  - ${a.destination}/${a.model} [${a.status ?? "sin status"}] ${a.message}`,
          )
          .join("\n"),
    );
    this.name = "AllTargetsFailedError";
  }
}
