/**
 * Leitor ANÔNIMO do chat da Twitch (IRC via WebSocket, login "justinfanNNNN" — só leitura,
 * não precisa de conta). Uma conexão só, entrando em vários canais.
 * Usa o WebSocket nativo do Node (>= 22).
 */

export interface ChatMessage {
  channel: string;
  user: string;
  text: string;
  at: number;
  /** Mensagem com bits (cheer). */
  bits: number;
}

/** Eventos do chat que NÃO são reação a lance: raid, sub, presente de sub, anúncio... */
export interface ChatEvent {
  channel: string;
  /** msg-id do USERNOTICE (raid, sub, resub, subgift, submysterygift, announcement...) */
  kind: string;
  at: number;
}

/** Interpreta uma linha IRC. Exportado para teste. */
export function parseIrcLine(line: string): {
  command: string;
  channel?: string;
  user?: string;
  text?: string;
  tags: Record<string, string>;
} {
  let rest = line;
  const tags: Record<string, string> = {};
  if (rest.startsWith("@")) {
    const sp = rest.indexOf(" ");
    for (const kv of rest.slice(1, sp).split(";")) {
      const eq = kv.indexOf("=");
      if (eq > 0) tags[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
    rest = rest.slice(sp + 1);
  }
  let prefix = "";
  if (rest.startsWith(":")) {
    const sp = rest.indexOf(" ");
    prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1);
  }
  const trailingIdx = rest.indexOf(" :");
  const trailing = trailingIdx >= 0 ? rest.slice(trailingIdx + 2) : undefined;
  const head = (trailingIdx >= 0 ? rest.slice(0, trailingIdx) : rest).split(" ");
  const command = head[0];
  if (command === "PRIVMSG" || command === "USERNOTICE") {
    return {
      command,
      channel: head[1]?.replace(/^#/, "").toLowerCase(),
      user: (prefix.split("!")[0] || tags.login || "").toLowerCase(),
      text: trailing ?? "",
      tags,
    };
  }
  return { command, text: trailing, tags };
}

export class TwitchChat {
  private ws: WebSocket | null = null;
  private joined = new Set<string>();
  private wanted = new Set<string>();
  private reconnectDelay = 1_000;
  private closed = false;
  private pingTimer: NodeJS.Timeout | null = null;
  private lastMessageAt = Date.now();

  constructor(
    private readonly onMessage: (m: ChatMessage) => void,
    private readonly log: (...a: unknown[]) => void = console.log,
    private readonly onEvent: (e: ChatEvent) => void = () => undefined,
  ) {}

  start(): void {
    this.closed = false;
    this.connect();
    // Watchdog: se a conexão "morrer calada", reconecta.
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastMessageAt > 6 * 60_000) {
        this.log("[chat] sem sinal há 6 min, reconectando...");
        this.ws.close();
        return;
      }
      this.send("PING :tmi.twitch.tv");
    }, 60_000);
  }

  stop(): void {
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
  }

  /** Define o conjunto de canais que devem estar abertos (entra/sai conforme a diferença). */
  setChannels(logins: Iterable<string>): void {
    const next = new Set([...logins].map((l) => l.toLowerCase()));
    for (const l of this.wanted) if (!next.has(l)) this.part(l);
    this.wanted = next;
    for (const l of next) if (!this.joined.has(l)) this.join(l);
  }

  private connect(): void {
    const ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    this.ws = ws;
    this.joined.clear();

    ws.addEventListener("open", () => {
      this.reconnectDelay = 1_000;
      this.lastMessageAt = Date.now();
      // tags/commands: para ver raids, subs e anúncios (USERNOTICE) e não confundir com lance.
      this.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
      this.send(`NICK justinfan${Math.floor(10000 + Math.random() * 89999)}`);
      for (const l of this.wanted) this.join(l);
      this.log(`[chat] conectado (${this.wanted.size} canal(is))`);
    });

    ws.addEventListener("message", (ev: MessageEvent) => {
      this.lastMessageAt = Date.now();
      const data = typeof ev.data === "string" ? ev.data : String(ev.data);
      for (const line of data.split("\r\n")) {
        if (!line) continue;
        if (line.startsWith("PING")) {
          this.send(line.replace("PING", "PONG"));
          continue;
        }
        const msg = parseIrcLine(line);
        if (msg.command === "PRIVMSG" && msg.channel && msg.user) {
          this.onMessage({
            channel: msg.channel,
            user: msg.user,
            text: msg.text ?? "",
            at: Date.now(),
            bits: Number(msg.tags.bits ?? 0) || 0,
          });
        } else if (msg.command === "USERNOTICE" && msg.channel) {
          this.onEvent({ channel: msg.channel, kind: msg.tags["msg-id"] ?? "", at: Date.now() });
        } else if (msg.command === "RECONNECT") {
          ws.close();
        }
      }
    });

    ws.addEventListener("close", () => {
      this.joined.clear();
      if (this.closed) return;
      this.log(`[chat] conexão caiu, reconectando em ${this.reconnectDelay / 1000}s`);
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(60_000, this.reconnectDelay * 2);
    });

    ws.addEventListener("error", () => {
      // o "close" vem em seguida e cuida da reconexão
    });
  }

  private join(login: string): void {
    if (this.send(`JOIN #${login}`)) {
      this.joined.add(login);
      this.log(`[chat] entrou em #${login}`);
    }
  }

  private part(login: string): void {
    this.send(`PART #${login}`);
    this.joined.delete(login);
    this.log(`[chat] saiu de #${login}`);
  }

  private send(line: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(`${line}\r\n`);
    return true;
  }
}
