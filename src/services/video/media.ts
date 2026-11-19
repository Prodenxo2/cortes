/**
 * Uma entrada de mídia para o ffmpeg: arquivo local OU URL remota (HLS da Twitch, DASH do YouTube...).
 * Com URL remota o ffmpeg busca só os pedaços necessários (seek por segmento / range request),
 * então dá para recortar um trecho de 60s de uma live de 6h sem baixar a live inteira.
 */
export interface MediaInput {
  url: string;
  /** Cabeçalhos HTTP que o yt-dlp informou para essa URL. */
  headers?: Record<string, string>;
}

export type MediaRef = MediaInput | string;

export function toInput(ref: MediaRef): MediaInput {
  return typeof ref === "string" ? { url: ref } : ref;
}

export function isRemote(ref: MediaRef): boolean {
  return /^https?:\/\//i.test(toInput(ref).url);
}

/**
 * Argumentos de entrada do ffmpeg com seek ANTES do -i (rápido e, como sempre re-encodamos, preciso).
 */
export function inputArgs(ref: MediaRef, opts: { start?: number; duration?: number } = {}): string[] {
  const input = toInput(ref);
  const args: string[] = [];
  if (isRemote(input)) {
    const headers = Object.entries(input.headers ?? {})
      .filter(([k]) => !/^(host|content-length)$/i.test(k))
      .map(([k, v]) => `${k}: ${v}\r\n`)
      .join("");
    if (headers) args.push("-headers", headers);
    // Robustez em rede: tolera quedas momentâneas na leitura HTTP.
    args.push("-rw_timeout", "30000000");
  }
  if (opts.start !== undefined && opts.start > 0) args.push("-ss", opts.start.toFixed(3));
  if (opts.duration !== undefined) args.push("-t", opts.duration.toFixed(3));
  args.push("-i", input.url);
  return args;
}
