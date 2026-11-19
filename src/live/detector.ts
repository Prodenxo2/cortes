/**
 * Detector de "momento bom" pelo chat. Cada canal tem uma média própria (um chat de 50 pessoas
 * e um de 20 mil reagem em escalas totalmente diferentes), então o pico é sempre relativo.
 *
 * Funciona em baldes de 5s. A cada balde fechado, olha a janela dos últimos 10s e compara com a
 * média móvel (EWMA) do próprio canal. Também conta risadas e reações de hype para classificar.
 */

export type TriggerKind = "risadas" | "hype" | "reacao";

export interface ChatTrigger {
  /** Início da janela que estourou (ms epoch, horário do chat). */
  at: number;
  /** Quantas vezes acima da média. */
  ratio: number;
  messages: number;
  users: number;
  kind: TriggerKind;
  /** Frase curta para exibir/mandar como contexto para a IA. */
  reason: string;
}

export interface DetectorOptions {
  bucketMs?: number;
  /** Quantos baldes formam a janela avaliada. */
  windowBuckets?: number;
  /** Meia-vida da média (s). */
  baselineHalfLifeSec?: number;
  /** Tempo mínimo de observação antes de disparar (s). */
  warmupSec?: number;
  /** Disparar quando a janela for >= ratio x média. */
  minRatio?: number;
  /** Piso absoluto de mensagens na janela (evita disparo em chat parado). */
  minMessages?: number;
  /** Piso de usuários diferentes na janela (evita spam de 1 pessoa ou bot). */
  minUsers?: number;
  cooldownSec?: number;
}

const LAUGH = /(kkk|hahaha|huehue|rsrs|\bkekw\b|\blul\b|\bomegalul\b|\blmao\b|\bicant\b|\bkek\b|😂|🤣)/i;
const HYPE = /(\bpog|\bclipa|\bclip\b|\bmonka|caralh|que isso|\bnoo+\b|\baaa+|\bw+\b|\bgg\b|\binsano|\babsurdo|🔥|😱)/i;

interface Bucket {
  start: number;
  total: number;
  laugh: number;
  hype: number;
  users: Map<string, number>;
}

/** Máximo de mensagens que contam por pessoa em cada balde (anti-spam/bot). */
const MAX_PER_USER_PER_BUCKET = 2;

export class ChatSpikeDetector {
  private readonly o: Required<DetectorOptions>;
  private current: Bucket;
  private recent: Bucket[] = [];
  private mean = 0;
  private variance = 0;
  private m2 = 0;
  private samples = 0;
  private firstAt: number;
  private lastTriggerAt = -Infinity;
  private suppressedUntil = 0;
  private pending: ChatTrigger | null = null;

  constructor(now: number, opts: DetectorOptions = {}) {
    this.o = {
      bucketMs: 5_000,
      windowBuckets: 2,
      baselineHalfLifeSec: 300,
      warmupSec: 180,
      minRatio: 3,
      minMessages: 8,
      minUsers: 5,
      cooldownSec: 120,
      ...opts,
    };
    this.firstAt = now;
    this.current = this.newBucket(now);
  }

  private newBucket(start: number): Bucket {
    return { start, total: 0, laugh: 0, hype: 0, users: new Map() };
  }

  add(user: string, text: string, now: number): void {
    // Fechar baldes aqui pode gerar um disparo: guarda para o próximo tick() entregar.
    this.pending = this.roll(now) ?? this.pending;
    const b = this.current;
    const n = b.users.get(user) ?? 0;
    if (n >= MAX_PER_USER_PER_BUCKET) return;
    b.users.set(user, n + 1);
    b.total++;
    if (LAUGH.test(text)) b.laugh++;
    else if (HYPE.test(text)) b.hype++;
  }

  /** Fecha os baldes vencidos e avalia. Chame periodicamente (ex: a cada 1s) e a cada mensagem. */
  tick(now: number): ChatTrigger | null {
    const t = this.roll(now) ?? this.pending;
    this.pending = null;
    return t;
  }

  /**
   * Ignora picos até `until` (ms). Usado em raid, chuva de sub e anúncio: o chat explode,
   * mas não por causa de um lance da live.
   */
  suppress(until: number): void {
    this.suppressedUntil = Math.max(this.suppressedUntil, until);
  }

  /** Razão atual da janela vs média (para exibir/debug). */
  get baseline(): number {
    return this.mean;
  }

  private roll(now: number): ChatTrigger | null {
    let trigger: ChatTrigger | null = null;
    while (now - this.current.start >= this.o.bucketMs) {
      this.recent.push(this.current);
      if (this.recent.length > this.o.windowBuckets) this.recent.shift();
      trigger = this.evaluate(this.current.start + this.o.bucketMs) ?? trigger;
      this.current = this.newBucket(this.current.start + this.o.bucketMs);
    }
    return trigger;
  }

  private evaluate(windowEnd: number): ChatTrigger | null {
    if (this.recent.length < this.o.windowBuckets) return null;
    const total = this.recent.reduce((n, b) => n + b.total, 0);
    const laugh = this.recent.reduce((n, b) => n + b.laugh, 0);
    const hype = this.recent.reduce((n, b) => n + b.hype, 0);
    const users = new Set(this.recent.flatMap((b) => [...b.users.keys()])).size;

    const warm = windowEnd - this.firstAt >= this.o.warmupSec * 1000;
    const std = Math.sqrt(this.variance);
    const base = Math.max(this.mean, 0.5);
    const ratio = total / base;

    let trigger: ChatTrigger | null = null;
    if (
      warm &&
      windowEnd - this.o.windowBuckets * this.o.bucketMs >= this.suppressedUntil &&
      windowEnd - this.lastTriggerAt >= this.o.cooldownSec * 1000 &&
      total >= this.o.minMessages &&
      users >= this.o.minUsers &&
      ratio >= this.o.minRatio &&
      total >= this.mean + 3 * std
    ) {
      const kind: TriggerKind = laugh / total >= 0.25 ? "risadas" : hype / total >= 0.2 ? "hype" : "reacao";
      const label = kind === "risadas" ? "risadas no chat" : kind === "hype" ? "hype no chat" : "chat agitado";
      this.lastTriggerAt = windowEnd;
      trigger = {
        at: windowEnd - this.o.windowBuckets * this.o.bucketMs,
        ratio: Number(ratio.toFixed(1)),
        messages: total,
        users,
        kind,
        reason: `Chat ${ratio.toFixed(1)}x acima da média (${label})`,
      };
    }

    // Atualiza a média DEPOIS de avaliar. Durante picos entra amortecido, para a média não "subir junto".
    const sample = this.samples > 0 ? Math.min(total, this.mean * 2 + 2) : total;
    const diff = sample - this.mean;
    if (!warm) {
      // Aquecimento: média simples (Welford), para não começar de zero e disparar à toa.
      this.samples++;
      this.mean += diff / this.samples;
      this.m2 += diff * (sample - this.mean);
      this.variance = this.m2 / this.samples;
    } else {
      const alpha = 1 - Math.pow(0.5, this.o.bucketMs / 1000 / this.o.baselineHalfLifeSec);
      this.samples++;
      this.mean += alpha * diff;
      this.variance = (1 - alpha) * (this.variance + alpha * diff * diff);
    }
    return trigger;
  }
}

/** Sensibilidade do canal (1..3) -> razão mínima. */
export function ratioForSensitivity(s: number): number {
  return s <= 1 ? 4.5 : s >= 3 ? 2.2 : 3;
}
