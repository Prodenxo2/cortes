import { GoogleGenAI } from "@google/genai";
import { getConfig, requireGeminiKey } from "@/lib/config";

let client: GoogleGenAI | null = null;

export function getGenAI(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: requireGeminiKey() });
  return client;
}

export function getModel(): string {
  return getConfig().gemini.model;
}

/** Modelo principal + reservas (GEMINI_FALLBACK_MODELS="modelo-a,modelo-b"), sem repetir. */
export function getModelChain(): string[] {
  const extra = (process.env.GEMINI_FALLBACK_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set([getModel(), ...extra])];
}

/** Cota DIÁRIA esgotada (não adianta tentar de novo agora). */
export class QuotaExceededError extends Error {
  constructor(
    public readonly retryAt: Date,
    public readonly models: string[],
  ) {
    super(
      `Cota diária do Gemini esgotada (${models.join(", ")}). ` +
        `Retoma automaticamente por volta de ${retryAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}. ` +
        `Para não ter esse limite, ative o faturamento da chave no Google AI Studio.`,
    );
    this.name = "QuotaExceededError";
  }
}

function isDailyQuota(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  return statusOf(err) === 429 && /PerDay|per day|RESOURCE_EXHAUSTED.*day/i.test(msg);
}

/** Lê o "retryDelay" (ex: "32590s") que o Gemini manda no erro de cota. */
function retryDelaySec(err: unknown): number {
  const msg = String((err as Error)?.message ?? err);
  const s = /"retryDelay"\s*:\s*"(\d+)s"/.exec(msg);
  if (s) return Number(s[1]);
  const hm = /retry in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i.exec(msg);
  if (hm) return Number(hm[1] ?? 0) * 3600 + Number(hm[2] ?? 0) * 60 + Math.ceil(Number(hm[3] ?? 0));
  return 3600;
}

/** Modelos com cota diária esgotada neste processo -> até quando. */
const exhausted = new Map<string, number>();

/**
 * Chama o Gemini no modelo principal; se a cota diária dele acabou, tenta os modelos reserva.
 * Se todos estiverem esgotados, lança QuotaExceededError (o worker reagenda o job sozinho).
 */
export async function generateWithFallback<T>(label: string, call: (model: string) => Promise<T>): Promise<T> {
  const chain = getModelChain();
  let soonest = Infinity;
  for (const model of chain) {
    const until = exhausted.get(model) ?? 0;
    if (until > Date.now()) {
      soonest = Math.min(soonest, until);
      continue;
    }
    try {
      return await withRetry(() => call(model), `${label} [${model}]`);
    } catch (err) {
      if (!isDailyQuota(err)) throw err;
      const until2 = Date.now() + Math.max(300, retryDelaySec(err)) * 1000;
      exhausted.set(model, until2);
      soonest = Math.min(soonest, until2);
      console.warn(`[gemini] cota diária de ${model} esgotada; ${chain.length > 1 ? "tentando o próximo modelo" : "sem modelo reserva"}`);
    }
  }
  throw new QuotaExceededError(new Date(Number.isFinite(soonest) ? soonest : Date.now() + 3600_000), chain);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown })?.status;
  return typeof s === "number" ? s : undefined;
}

function isNetworkError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|network/i.test(msg);
}

/** Retry com backoff exponencial para 429 (quota/rate limit), 5xx e falhas de rede. */
export async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = statusOf(err);
      const retryable =
        status === undefined ? isNetworkError(err) : (status === 429 && !isDailyQuota(err)) || status >= 500;
      if (!retryable || i === attempts - 1) break;
      const delay = Math.min(30_000, 2_000 * 2 ** i) + Math.random() * 1_000;
      console.warn(
        `[gemini] ${label} falhou (${status ?? (err as Error).message}). Nova tentativa em ${Math.round(delay / 1000)}s...`,
      );
      await sleep(delay);
    }
  }
  const status = statusOf(lastErr);
  if (status === 404) {
    throw new Error(
      `[gemini] ${label}: modelo "${getModel()}" não encontrado (404). Confira GEMINI_MODEL no .env. Detalhe: ${(lastErr as Error).message}`,
    );
  }
  throw lastErr;
}

/** Faz parse do JSON da resposta, tolerando cercas ```json que alguns modelos ainda mandam. */
export function parseJsonResponse<T>(text: string | undefined, label: string): T {
  if (!text) throw new Error(`[gemini] ${label}: resposta vazia (possível bloqueio de segurança ou limite de tokens).`);
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(`[gemini] ${label}: JSON inválido na resposta:\n${cleaned.slice(0, 500)}`);
  }
}
