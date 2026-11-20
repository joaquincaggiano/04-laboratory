import { AllTargetsFailedError, LLMError } from "../contracts.js";
import type {
  Attempt,
  LLMAdapter,
  LLMRequest,
  LLMResponse,
} from "../contracts.js";

export const COOLDOWN_MS = 30_000;
export const FAILURE_THRESHOLD = 1;

export type Logger = (message: string) => void;

export interface Target {
  destination: string;
  model: string; // modelo real del destino
  adapter: LLMAdapter;
}

export type CircuitState = "closed" | "open" | "half-open";

interface Circuit {
  failures: number;
  openUntil: number | null;
  probing: boolean;
}

export interface BreakerOptions {
  cooldownMs?: number;
  failureThreshold?: number;
}

const circuits = new Map<string, Circuit>();

export const targetKey = (t: Pick<Target, "destination" | "model">) =>
  `${t.destination}:${t.model}`;

export function getState(key: string, now = Date.now()): CircuitState {
  const c = circuits.get(key);
  if (!c || c.openUntil === null) return "closed";
  return now >= c.openUntil ? "half-open" : "open";
}

/** true si el destino no está en espera (closed, o el cooldown ya venció). */
export function cooldownPassed(key: string, now = Date.now()): boolean {
  return getState(key, now) !== "open";
}

export function cooldownRemainingMs(key: string, now = Date.now()): number {
  const until = circuits.get(key)?.openUntil;
  return until == null ? 0 : Math.max(0, until - now);
}

export function canAttempt(key: string, now = Date.now()): boolean {
  const state = getState(key, now);
  if (state === "closed") return true;
  if (state === "open") return false;
  return !circuits.get(key)!.probing; // half-open: una sola prueba a la vez
}

/** Admite la petición. En half-open ocupa el único hueco de prueba. */
export function acquire(key: string, now = Date.now()): boolean {
  if (!canAttempt(key, now)) return false;
  if (getState(key, now) === "half-open") circuits.get(key)!.probing = true;
  return true;
}

export function recordSuccess(key: string): void {
  circuits.delete(key);
}

export function recordFailure(
  key: string,
  opts: BreakerOptions = {},
  now = Date.now(),
): CircuitState {
  const { cooldownMs = COOLDOWN_MS, failureThreshold = FAILURE_THRESHOLD } =
    opts;
  const state = getState(key, now);
  let c = circuits.get(key);
  if (!c)
    circuits.set(key, (c = { failures: 0, openUntil: null, probing: false }));

  if (state !== "closed" || ++c.failures >= failureThreshold) {
    c.openUntil = now + cooldownMs;
    c.probing = false;
  }
  return getState(key, now);
}

export function releaseProbe(key: string): void {
  const c = circuits.get(key);
  if (c) c.probing = false;
}

export function resetBreakers(): void {
  circuits.clear();
}

// ------------------------------------------------------------------- retries

export interface RetryOptions {
  retries?: number;
  retryDelayMs?: number;
  logger?: Logger;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function callWithRetries<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { retries = 0, retryDelayMs = 300, logger = () => {} } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err instanceof LLMError && err.kind === "transient";
      if (!retryable || attempt >= retries) throw err;
      const wait = retryDelayMs * 2 ** attempt;
      logger(
        `   ↻ reintento ${attempt + 1}/${retries} en ${wait}ms (${err.message})`,
      );
      await sleep(wait);
    }
  }
}

// ------------------------------------------------------------------ fallback

export interface FallbackOptions extends RetryOptions, BreakerOptions {}

/**
 * Recorre los destinos en orden.
 *  - error pasajero    -> cuenta para el breaker y prueba el siguiente
 *  - error de petición -> se lanza ya: fallaría igual en cualquier otro destino (no toca el breaker)
 *  - los destinos open (o con la prueba half-open ocupada) se dejan para el final, como último recurso
 */
export async function callWithFallback(
  targets: Target[],
  request: LLMRequest,
  opts: FallbackOptions = {},
): Promise<LLMResponse> {
  const {
    cooldownMs,
    failureThreshold,
    logger = () => {},
    ...retryOpts
  } = opts;
  const breaker = { cooldownMs, failureThreshold };

  const ordered = [
    ...targets.filter((t) => canAttempt(targetKey(t))),
    ...targets.filter((t) => !canAttempt(targetKey(t))),
  ];
  const attempts: Attempt[] = [];

  for (const target of ordered) {
    const key = targetKey(target);
    const label = `${target.destination}/${target.model}`;
    const before = getState(key);
    const admitted = acquire(key);

    if (!admitted)
      logger(
        `⏳ ${label} [${before}${before === "open" ? `, ${Math.ceil(cooldownRemainingMs(key) / 1000)}s` : ", prueba en curso"}]: último recurso`,
      );
    else if (before === "half-open")
      logger(`🟡 ${label} [half-open]: petición de prueba`);
    else logger(`→ ${label}`);

    try {
      const response = await callWithRetries(
        () => target.adapter({ ...request, model: target.model }),
        { ...retryOpts, logger },
      );
      recordSuccess(key);
      if (before !== "closed") logger(`🟢 ${label}: ${before} → closed`);
      return { ...response, destination: target.destination };
    } catch (err) {
      if (!(err instanceof LLMError)) {
        releaseProbe(key);
        throw err;
      }
      if (err.kind === "request") {
        releaseProbe(key);
        logger(`✖ ${label}: error de petición [${err.status}], sin fallback`);
        throw err;
      }
      const after = recordFailure(key, breaker);
      attempts.push({
        destination: target.destination,
        model: target.model,
        status: err.status,
        message: err.message,
      });
      logger(
        `⚠ ${label}: error pasajero [${err.status ?? "sin status"}]${after !== before ? ` (${before} → ${after})` : ` (${after})`}, siguiente destino`,
      );
    }
  }

  throw new AllTargetsFailedError(attempts);
}
