import type { Channel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { focusLabels, parseFocus, sanitizeInstructions } from "@/lib/focus";
import { ChatSpikeDetector, ratioForSensitivity, type ChatTrigger } from "./detector";
import { TwitchChat } from "./twitch-chat";
import {
  getLatestArchive,
  getLiveStreams,
  getVideo,
  parseTwitchDuration,
  type TwitchStream,
} from "./twitch-api";

/** O chat reage alguns segundos DEPOIS do lance (atraso da live + tempo de digitar). */
const CHAT_LEAD_SEC = 12;
/** Quanto do que veio depois do pico entra na janela analisada. */
const AFTER_SEC = 25;
/** Tempo mínimo entre dois cortes automáticos do mesmo canal/usuário. */
const COOLDOWN_SEC = 150;
/** Desiste de um pico se o VOD não cobrir o trecho nesse prazo. */
const PENDING_TTL_MS = 30 * 60_000;

/** Bots comuns da Twitch: mensagens deles não contam como reação. */
const BOTS = new Set([
  "nightbot",
  "streamelements",
  "streamlabs",
  "moobot",
  "fossabot",
  "wizebot",
  "soundalerts",
  "sery_bot",
  "botrixoficial",
  "kofistreambot",
  "pokemoncommunitygame",
  "commanderroot",
  "lolrankbot",
  "creatisbot",
]);

const log = (...a: unknown[]) => console.log(`[live ${new Date().toLocaleTimeString("pt-BR")}]`, ...a);

interface PendingClip {
  channelId: string;
  /** Momento estimado do lance (ms epoch). */
  eventAt: number;
  /** Momento do pico do chat (ms epoch). */
  chatAt: number;
  trigger: ChatTrigger;
  createdAt: number;
}

interface LiveState {
  login: string;
  stream: TwitchStream;
  sessionId: string;
  vod: { id: string; createdAt: number } | null;
  vodCheckedAt: number;
  vodDuration: { value: number; at: number };
  detector: ChatSpikeDetector;
  pending: PendingClip[];
  ended: boolean;
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export class LiveWatcher {
  private states = new Map<string, LiveState>();
  private channels = new Map<string, Channel[]>(); // login -> canais (um por usuário)
  private lastClipAt = new Map<string, number>(); // channelId -> ms
  private chat = new TwitchChat(
    (m) => this.onChat(m.channel, m.user, m.text, m.at, m.bits),
    log,
    (e) => this.onChatEvent(e.channel, e.kind, e.at),
  );
  private timers: NodeJS.Timeout[] = [];

  async start(): Promise<void> {
    this.chat.start();
    await this.refresh().catch((e) => log("erro no refresh:", e.message));
    this.timers.push(
      setInterval(() => void this.refresh().catch((e) => log("erro no refresh:", e.message)), 60_000),
      setInterval(() => void this.processPending().catch((e) => log("erro nos pendentes:", e.message)), 30_000),
      setInterval(() => this.tickDetectors(), 1_000),
    );
  }

  stop(): void {
    this.timers.forEach(clearInterval);
    this.chat.stop();
  }

  /** Recarrega canais do banco, vê quem está ao vivo, abre/fecha sessões e o chat. */
  private async refresh(): Promise<void> {
    const rows = await prisma.channel.findMany({ where: { enabled: true, platform: "twitch" } });
    this.channels = new Map();
    for (const c of rows) this.channels.set(c.login, [...(this.channels.get(c.login) ?? []), c]);
    const logins = [...this.channels.keys()];

    const live = logins.length ? await getLiveStreams(logins) : [];
    const liveByLogin = new Map(live.map((s) => [s.user_login.toLowerCase(), s]));

    // Novas lives / troca de stream
    for (const [login, stream] of liveByLogin) {
      const st = this.states.get(login);
      if (!st || st.stream.id !== stream.id) {
        if (st) await this.endSession(st);
        await this.openSession(login, stream);
      }
    }
    // Lives que acabaram (ou canal desativado)
    for (const st of this.states.values()) {
      if (!st.ended && !liveByLogin.has(st.login)) await this.endSession(st);
    }
    // Descobre o VOD em andamento
    for (const st of this.states.values()) {
      if (!st.ended && !st.vod && Date.now() - st.vodCheckedAt > 60_000) await this.findVod(st);
    }

    this.chat.setChannels([...this.states.values()].filter((s) => !s.ended).map((s) => s.login));
  }

  private async openSession(login: string, stream: TwitchStream): Promise<void> {
    const session = await prisma.liveSession.upsert({
      where: { streamId: stream.id },
      create: { login, streamId: stream.id, title: stream.title.slice(0, 512), startedAt: new Date(stream.started_at) },
      update: { endedAt: null },
    });
    const subs = this.channels.get(login) ?? [];
    const minRatio = Math.min(...subs.map((c) => ratioForSensitivity(c.sensitivity)));
    const st: LiveState = {
      login,
      stream,
      sessionId: session.id,
      vod: session.vodId && session.vodCreatedAt ? { id: session.vodId, createdAt: session.vodCreatedAt.getTime() } : null,
      vodCheckedAt: 0,
      vodDuration: { value: 0, at: 0 },
      detector: new ChatSpikeDetector(Date.now(), { minRatio }),
      pending: [],
      ended: false,
    };
    this.states.set(login, st);
    log(`🔴 ${login} AO VIVO: "${stream.title}" (${subs.length} usuário(s) monitorando)`);
    await this.findVod(st);
  }

  private async findVod(st: LiveState): Promise<void> {
    st.vodCheckedAt = Date.now();
    const vod = await getLatestArchive(st.stream.user_id).catch(() => null);
    const startedAt = new Date(st.stream.started_at).getTime();
    // O VOD da live atual tem stream_id igual, ou foi criado perto do início da live.
    if (vod && (vod.stream_id === st.stream.id || Math.abs(new Date(vod.created_at).getTime() - startedAt) < 10 * 60_000)) {
      st.vod = { id: vod.id, createdAt: new Date(vod.created_at).getTime() };
      await prisma.liveSession.update({
        where: { id: st.sessionId },
        data: { vodId: vod.id, vodCreatedAt: new Date(vod.created_at) },
      });
      log(`${st.login}: VOD em andamento ${vod.id}`);
    } else if (Date.now() - startedAt > 15 * 60_000) {
      log(`${st.login}: nenhum VOD encontrado — o canal pode estar com "salvar transmissões" desligado.`);
    }
  }

  private async endSession(st: LiveState): Promise<void> {
    st.ended = true;
    await prisma.liveSession.update({ where: { id: st.sessionId }, data: { endedAt: new Date() } }).catch(() => undefined);
    log(`⚫ ${st.login} saiu do ar (${st.pending.length} corte(s) ainda pendente(s))`);
    if (st.pending.length === 0) this.states.delete(st.login);
  }

  private onChat(login: string, user: string, text: string, at: number, bits: number): void {
    const st = this.states.get(login);
    if (!st || st.ended) return;
    // Ruído que não é reação a lance: comandos (!sorteio, !discord), bots e cheers de bits.
    if (text.startsWith("!") || BOTS.has(user) || bits > 0) return;
    st.detector.add(user, text, at);
    const trig = st.detector.tick(at);
    if (trig) void this.onTrigger(st, trig);
  }

  /** Raid, chuva de sub e anúncio fazem o chat explodir sem lance nenhum: silencia o detector um pouco. */
  private onChatEvent(login: string, kind: string, at: number): void {
    const st = this.states.get(login);
    if (!st || st.ended) return;
    const quietSec: Record<string, number> = {
      raid: 120,
      submysterygift: 60,
      subgift: 20,
      announcement: 45,
      sub: 10,
      resub: 10,
      giftpaidupgrade: 10,
    };
    const sec = quietSec[kind];
    if (!sec) return;
    st.detector.suppress(at + sec * 1000);
    if (kind === "raid" || kind === "submysterygift") log(`${login}: ${kind} — ignorando o chat por ${sec}s`);
  }

  private tickDetectors(): void {
    const now = Date.now();
    for (const st of this.states.values()) {
      if (st.ended) continue;
      const trig = st.detector.tick(now);
      if (trig) void this.onTrigger(st, trig);
    }
  }

  private async onTrigger(st: LiveState, trig: ChatTrigger): Promise<void> {
    log(`⚡ ${st.login}: ${trig.reason} — ${trig.messages} msgs de ${trig.users} pessoas`);
    await prisma.liveSession.update({ where: { id: st.sessionId }, data: { triggers: { increment: 1 } } }).catch(() => undefined);

    const now = Date.now();
    for (const ch of this.channels.get(st.login) ?? []) {
      if (trig.ratio < ratioForSensitivity(ch.sensitivity)) continue;
      if (now - (this.lastClipAt.get(ch.id) ?? 0) < COOLDOWN_SEC * 1000) continue;
      const lastHour = await prisma.project.count({
        // Descartados pelo filtro não contam no limite por hora.
        where: { channelId: ch.id, createdAt: { gte: new Date(now - 3600_000) }, status: { not: "DISCARDED" } },
      });
      const pendingForCh = st.pending.filter((p) => p.channelId === ch.id).length;
      if (lastHour + pendingForCh >= ch.maxClipsPerHour) {
        log(`${st.login}: limite de ${ch.maxClipsPerHour} cortes/hora atingido para o usuário ${ch.userId}`);
        continue;
      }
      this.lastClipAt.set(ch.id, now);
      st.pending.push({ channelId: ch.id, eventAt: trig.at - CHAT_LEAD_SEC * 1000, chatAt: trig.at, trigger: trig, createdAt: now });
    }
  }

  /** Cria os projetos dos picos cujo trecho já está disponível no VOD. */
  private async processPending(): Promise<void> {
    for (const st of [...this.states.values()]) {
      if (st.pending.length === 0) {
        if (st.ended) this.states.delete(st.login);
        continue;
      }
      if (!st.vod) {
        st.pending = st.pending.filter((p) => Date.now() - p.createdAt < PENDING_TTL_MS);
        continue;
      }
      // Duração atual do VOD (cache de 30s)
      if (Date.now() - st.vodDuration.at > 30_000) {
        const v = await getVideo(st.vod.id).catch(() => null);
        st.vodDuration = { value: v ? parseTwitchDuration(v.duration) : st.vodDuration.value, at: Date.now() };
      }

      const keep: PendingClip[] = [];
      for (const p of st.pending) {
        const ch = (this.channels.get(st.login) ?? []).find((c) => c.id === p.channelId);
        if (!ch) continue;
        const window = Math.max(95, ch.maxClipSeconds + 25);
        const eventSec = (p.eventAt - st.vod.createdAt) / 1000;
        const start = Math.max(0, eventSec - (window - AFTER_SEC));
        const end = eventSec + AFTER_SEC;

        if (st.vodDuration.value >= end + 10 || (st.ended && st.vodDuration.value >= start + 30)) {
          await this.createProject(st, ch, p, start, Math.min(end, st.vodDuration.value || end));
        } else if (Date.now() - p.createdAt > PENDING_TTL_MS) {
          log(`${st.login}: VOD não alcançou o trecho em 30 min, descartando pico.`);
        } else {
          keep.push(p);
        }
      }
      st.pending = keep;
      if (st.ended && keep.length === 0) this.states.delete(st.login);
    }
  }

  private async createProject(st: LiveState, ch: Channel, p: PendingClip, start: number, end: number): Promise<void> {
    const chatPos = Math.max(0, (p.chatAt - st.vod!.createdAt) / 1000 - start);
    const hint =
      `Este trecho foi marcado porque o chat explodiu (${p.trigger.kind}) por volta de ${fmt(chatPos).slice(2)} deste áudio. ` +
      `O lance provavelmente acontece um pouco antes. Escolha o corte em volta desse momento.`;
    const userExtra = ch.instructions ? ` Pedido do criador: ${ch.instructions}` : "";
    const focus = parseFocus(ch.focus);

    const project = await prisma.project.create({
      data: {
        userId: ch.userId,
        channelId: ch.id,
        liveSessionId: st.sessionId,
        sourceUrl: `https://www.twitch.tv/videos/${st.vod!.id}`,
        sourceTitle: st.stream.title.slice(0, 512),
        sourceCreator: st.stream.user_name,
        layoutPreset: ch.layoutPreset,
        minClipSeconds: ch.minClipSeconds,
        maxClipSeconds: ch.maxClipSeconds,
        clipCount: 1,
        language: ch.language,
        focus: focus.join(","),
        instructions: sanitizeInstructions(hint + userExtra),
        section: `${fmt(start)}-${fmt(end)}`,
        triggerReason: p.trigger.reason.slice(0, 255),
        maxAttempts: 4,
        minViralScore: ch.minScore,
        priority: 1, // cortes da live são curtos e "quentes": passam na frente de VODs longos
      },
      select: { id: true },
    });
    log(
      `✂️  ${st.login}: corte automático criado (${project.id}) trecho ${fmt(start)}-${fmt(end)}` +
        (focus.length ? ` foco ${focusLabels(focus).join("/")}` : ""),
    );
  }
}
