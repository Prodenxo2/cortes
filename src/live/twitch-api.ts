/**
 * Cliente mínimo da API oficial da Twitch (Helix), com token de app (client credentials).
 * Precisa de TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET (app grátis em dev.twitch.tv/console).
 */

export interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
}

export interface TwitchStream {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  title: string;
  started_at: string;
  type: string;
}

export interface TwitchVideo {
  id: string;
  stream_id: string | null;
  user_id: string;
  created_at: string;
  url: string;
  /** Formato "1h2m3s" */
  duration: string;
  type: string;
}

let token: { value: string; expiresAt: number } | null = null;

export function twitchConfigured(): boolean {
  return Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);
}

async function getToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  const id = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;
  if (!id || !secret) throw new Error("TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET não configurados.");
  const body = new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "client_credentials" });
  const res = await fetch("https://id.twitch.tv/oauth2/token", { method: "POST", body });
  if (!res.ok) throw new Error(`Twitch token: HTTP ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return token.value;
}

async function helix<T>(path: string, params: [string, string][]): Promise<T[]> {
  const url = new URL(`https://api.twitch.tv/helix/${path}`);
  for (const [k, v] of params) url.searchParams.append(k, v);
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      headers: { "Client-Id": process.env.TWITCH_CLIENT_ID ?? "", Authorization: `Bearer ${await getToken()}` },
    });
    if (res.status === 401 && attempt === 0) {
      token = null; // token vencido/revogado: pega outro e tenta de novo
      continue;
    }
    if (!res.ok) throw new Error(`Twitch ${path}: HTTP ${res.status} ${await res.text()}`);
    return ((await res.json()) as { data: T[] }).data;
  }
  return [];
}

export async function getUsers(logins: string[]): Promise<TwitchUser[]> {
  if (logins.length === 0) return [];
  return helix<TwitchUser>("users", logins.slice(0, 100).map((l) => ["login", l]));
}

/** Streams ao vivo entre os logins informados (até 100 por chamada). */
export async function getLiveStreams(logins: string[]): Promise<TwitchStream[]> {
  const out: TwitchStream[] = [];
  for (let i = 0; i < logins.length; i += 100) {
    const chunk = logins.slice(i, i + 100).map((l): [string, string] => ["user_login", l]);
    out.push(...(await helix<TwitchStream>("streams", chunk)));
  }
  return out.filter((s) => s.type === "live");
}

/** VOD (arquivo) mais recente do canal — durante a live, é a gravação em andamento. */
export async function getLatestArchive(userId: string): Promise<TwitchVideo | null> {
  const data = await helix<TwitchVideo>("videos", [
    ["user_id", userId],
    ["type", "archive"],
    ["first", "1"],
  ]);
  return data[0] ?? null;
}

export async function getVideo(id: string): Promise<TwitchVideo | null> {
  const data = await helix<TwitchVideo>("videos", [["id", id]]);
  return data[0] ?? null;
}

/** "1h2m3s" -> 3723 */
export function parseTwitchDuration(d: string): number {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(d.trim());
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** Aceita "gaules", "@gaules", "twitch.tv/gaules", "https://www.twitch.tv/gaules/videos". */
export function normalizeTwitchLogin(input: string): string | null {
  let v = input.trim();
  const m = /twitch\.tv\/([A-Za-z0-9_]{3,25})/i.exec(v);
  if (m) v = m[1];
  v = v.replace(/^@/, "");
  return /^[A-Za-z0-9_]{3,25}$/.test(v) ? v.toLowerCase() : null;
}
