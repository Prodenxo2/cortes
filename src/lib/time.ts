/**
 * Converte "HH:MM:SS.mmm", "MM:SS", "SS.mmm" (vírgula também aceita) ou número em segundos.
 * Lança erro se não conseguir interpretar.
 */
export function parseTimestamp(input: string | number): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new Error(`Timestamp inválido: ${input}`);
    return input;
  }
  const raw = input.trim().replace(",", ".");
  if (/^\d+(\.\d+)?$/.test(raw)) return Number(raw);

  const parts = raw.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) {
    throw new Error(`Timestamp inválido: "${input}"`);
  }
  const nums = parts.map(Number);
  const [h, m, s] = nums.length === 3 ? nums : [0, nums[0], nums[1]];
  return h * 3600 + m * 60 + s;
}

/** Segundos -> "HH:MM:SS.mmm" */
export function formatTimestamp(totalSeconds: number): string {
  const ms = Math.max(0, Math.round(totalSeconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}.${String(rest).padStart(3, "0")}`;
}

/** Segundos -> "H:MM:SS.cc" (formato de tempo do .ass) */
export function formatAssTime(totalSeconds: number): string {
  const cs = Math.max(0, Math.round(totalSeconds * 100));
  const h = Math.floor(cs / 360_000);
  const m = Math.floor((cs % 360_000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const rest = cs % 100;
  return `${h}:${pad(m)}:${pad(s)}.${pad(rest)}`;
}

/** "00:00-10:00" -> { start, end } em segundos */
export function parseRange(range: string): { start: number; end: number } {
  const [a, b] = range.split("-").map((p) => p.trim());
  if (!a || !b) throw new Error(`Intervalo inválido: "${range}" (use INICIO-FIM, ex: 00:00-10:00)`);
  const start = parseTimestamp(a);
  const end = parseTimestamp(b);
  if (end <= start) throw new Error(`Intervalo inválido: fim antes do início em "${range}"`);
  return { start, end };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
