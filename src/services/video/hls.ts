import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import type { MediaInput, MediaRef } from "./media";
import { toInput } from "./media";

/**
 * Baixa de uma playlist HLS SÓ os segmentos que cobrem [start, end].
 *
 * Por quê: num VOD ainda gravando (playlist sem #EXT-X-ENDLIST), o ffmpeg não consegue fazer seek e
 * lê tudo desde o início — num trecho às 9h de live, isso é baixar 9h. Aqui calculamos o tempo de cada
 * segmento pelo #EXTINF e buscamos só os necessários, em paralelo. Segmentos MPEG-TS podem ser
 * concatenados direto; fMP4 recebe o segmento de inicialização (#EXT-X-MAP) na frente.
 */

interface Segment {
  url: string;
  start: number;
  duration: number;
}

interface MediaPlaylist {
  segments: Segment[];
  initUrl?: string;
  encrypted: boolean;
}

export function isHls(ref: MediaRef): boolean {
  return /\.m3u8(\?|$)/i.test(toInput(ref).url);
}

async function fetchText(url: string, input: MediaInput, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, { headers: input.headers, signal });
  if (!res.ok) throw new Error(`HLS: HTTP ${res.status} ao ler playlist`);
  return res.text();
}

/** Interpreta uma playlist de mídia. Exportado para teste. */
export function parseMediaPlaylist(text: string, baseUrl: string): MediaPlaylist | { variants: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (lines.some((l) => l.startsWith("#EXT-X-STREAM-INF"))) {
    const variants: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
        const uri = lines.slice(i + 1).find((l) => l && !l.startsWith("#"));
        if (uri) variants.push(new URL(uri, baseUrl).toString());
      }
    }
    return { variants };
  }

  const segments: Segment[] = [];
  let t = 0;
  let pendingDur: number | null = null;
  let initUrl: string | undefined;
  let encrypted = false;
  for (const l of lines) {
    if (l.startsWith("#EXTINF:")) {
      pendingDur = parseFloat(l.slice(8));
    } else if (l.startsWith("#EXT-X-MAP:")) {
      const m = /URI="([^"]+)"/.exec(l);
      if (m) initUrl = new URL(m[1], baseUrl).toString();
    } else if (l.startsWith("#EXT-X-KEY:")) {
      if (!/METHOD=NONE/i.test(l)) encrypted = true;
    } else if (l && !l.startsWith("#") && pendingDur !== null) {
      segments.push({ url: new URL(l, baseUrl).toString(), start: t, duration: pendingDur });
      t += pendingDur;
      pendingDur = null;
    }
  }
  return { segments, initUrl, encrypted };
}

async function loadPlaylist(input: MediaInput, signal?: AbortSignal): Promise<MediaPlaylist> {
  let url = input.url;
  for (let depth = 0; depth < 2; depth++) {
    const parsed = parseMediaPlaylist(await fetchText(url, input, signal), url);
    if ("variants" in parsed) {
      if (!parsed.variants.length) throw new Error("HLS: playlist mestre sem variantes.");
      url = parsed.variants[0];
      continue;
    }
    return parsed;
  }
  throw new Error("HLS: playlist inválida.");
}

export interface HlsRangeResult {
  /** Arquivo local com os segmentos. */
  file: string;
  /** Tempo (no vídeo original) em que o arquivo começa. Use `inicioDesejado - startTime` como -ss local. */
  startTime: number;
  /** Até onde a playlist tem conteúdo (útil para VOD em gravação). */
  available: number;
}

export async function downloadHlsRange(
  ref: MediaRef,
  start: number,
  end: number,
  outFile: string,
  opts: { signal?: AbortSignal; concurrency?: number; onProgress?: (ratio: number) => void } = {},
): Promise<HlsRangeResult> {
  const input = toInput(ref);
  const pl = await loadPlaylist(input, opts.signal);
  if (pl.encrypted) throw new Error("HLS criptografado: não suportado pelo modo por segmentos.");
  if (pl.segments.length === 0) throw new Error("HLS: playlist sem segmentos.");

  const last = pl.segments[pl.segments.length - 1];
  const available = last.start + last.duration;
  if (start >= available) {
    throw new Error(`TRECHO_INDISPONIVEL: o vídeo ainda só tem ${Math.floor(available)}s gravados.`);
  }

  // 1 segmento de folga de cada lado (o primeiro quadro-chave pode estar no começo do segmento).
  const picked = pl.segments.filter((s) => s.start + s.duration > start - 1 && s.start < end + 1);
  if (picked.length === 0) throw new Error("HLS: nenhum segmento no trecho pedido.");

  const concurrency = opts.concurrency ?? 8;
  const buffers: (Buffer | null)[] = new Array(picked.length).fill(null);
  let next = 0;
  let done = 0;

  const fetchSeg = async (url: string): Promise<Buffer> => {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url, { headers: input.headers, signal: opts.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
      } catch (err) {
        if (opts.signal?.aborted || attempt >= 3) throw new Error(`HLS: falha ao baixar segmento (${(err as Error).message})`);
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  };

  // Baixa em paralelo, mas grava na ordem.
  const out = createWriteStream(outFile);
  const writeDone = new Promise<void>((resolve, reject) => {
    out.on("finish", resolve);
    out.on("error", reject);
  });
  if (pl.initUrl) out.write(await fetchSeg(pl.initUrl));
  let written = 0;
  const flush = () => {
    while (written < buffers.length && buffers[written]) {
      out.write(buffers[written]!);
      buffers[written] = null; // libera memória
      written++;
    }
  };
  const workers = Array.from({ length: Math.min(concurrency, picked.length) }, async () => {
    while (next < picked.length) {
      const i = next++;
      buffers[i] = await fetchSeg(picked[i].url);
      done++;
      opts.onProgress?.(done / picked.length);
      flush();
    }
  });
  try {
    await Promise.all(workers);
    flush();
  } finally {
    out.end();
  }
  await writeDone;
  await fs.access(outFile);

  return { file: outFile, startTime: picked[0].start, available };
}
