/**
 * Montagem do canvas vertical 1080x1920 via filter_complex do ffmpeg.
 * Todos os recortes são em FRAÇÕES (0..1) do frame original, então funcionam
 * para fontes 1080p, 720p, 1440p etc. sem mudar a configuração.
 */

export const CANVAS_W = 1080;
export const CANVAS_H = 1920;

export type LayoutPreset = "split" | "center" | "blur";

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutOptions {
  preset: LayoutPreset;
  /** Região da webcam no vídeo original (preset split). */
  webcam?: CropRect;
  /** Região da gameplay a usar (default: frame inteiro). O crop 9:16 é feito no centro dessa região. */
  gameplay?: CropRect;
  /** Fração da altura do canvas ocupada pela webcam no split (default 0.35). */
  camHeightRatio?: number;
}

/** Webcam padrão: canto superior direito, ~28% x 30% do frame. Ajuste com --cam. */
export const DEFAULT_WEBCAM: CropRect = { x: 0.72, y: 0, w: 0.28, h: 0.3 };

export function parseRect(value: string): CropRect {
  const nums = value.split(",").map((v) => Number(v.trim()));
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n) || n < 0 || n > 1)) {
    throw new Error(`Retângulo inválido "${value}". Use x,y,w,h em frações 0..1 (ex: 0.72,0,0.28,0.3)`);
  }
  const [x, y, w, h] = nums;
  if (w <= 0 || h <= 0 || x + w > 1.0001 || y + h > 1.0001) {
    throw new Error(`Retângulo "${value}" sai do frame (x+w e y+h devem ser <= 1).`);
  }
  return { x, y, w, h };
}

const even = (n: number) => Math.round(n / 2) * 2;
const f = (n: number) => Number(n.toFixed(4)).toString();

function cropExpr(r: CropRect | undefined): string {
  if (!r || (r.x === 0 && r.y === 0 && r.w === 1 && r.h === 1)) return "";
  return `crop=iw*${f(r.w)}:ih*${f(r.h)}:iw*${f(r.x)}:ih*${f(r.y)},`;
}

/** Escala para cobrir WxH e corta o centro (equivale a um crop central na proporção desejada). */
function cover(w: number, h: number): string {
  return `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}`;
}

export function splitHeights(opts: LayoutOptions): { camH: number; gameH: number } {
  const ratio = Math.min(0.5, Math.max(0.2, opts.camHeightRatio ?? 0.35));
  const camH = even(CANVAS_H * ratio);
  return { camH, gameH: CANVAS_H - camH };
}

/**
 * Altura da faixa da webcam proporcional ao formato da câmera detectada:
 * câmera 16:9 -> faixa de ~608px, câmera 4:3 -> ~810px (limitada a 25%-45% da tela).
 * Assim a câmera não é esticada nem cortada demais.
 */
export function autoCamHeightRatio(cam: CropRect, sourceW: number, sourceH: number): number {
  const camAspect = (cam.w * sourceW) / (cam.h * sourceH);
  const ratio = CANVAS_W / camAspect / CANVAS_H;
  return Math.min(0.45, Math.max(0.25, ratio));
}

/** Encolhe o retângulo por uma margem relativa de cada lado (tira bordas/molduras do overlay). */
export function insetRect(r: CropRect, frac: number): CropRect {
  const dx = r.w * frac;
  const dy = r.h * frac;
  return { x: r.x + dx, y: r.y + dy, w: r.w - 2 * dx, h: r.h - 2 * dy };
}

/**
 * Gera o filter_complex. Entrada [0:v], saída [vout].
 * @param assFile nome do arquivo .ass RELATIVO ao cwd do ffmpeg (evita o inferno de escapar "C:\" no filtro).
 */
export function buildFilterGraph(opts: LayoutOptions, assFile?: string): string {
  const tail = `setsar=1,format=yuv420p${assFile ? `,ass=${assFile}` : ""}[vout]`;
  const game = cropExpr(opts.gameplay);

  switch (opts.preset) {
    case "split": {
      const { camH, gameH } = splitHeights(opts);
      const cam = cropExpr(opts.webcam ?? DEFAULT_WEBCAM);
      return [
        `[0:v]split=2[camsrc][gamesrc]`,
        `[camsrc]${cam}${cover(CANVAS_W, camH)}[cam]`,
        `[gamesrc]${game}${cover(CANVAS_W, gameH)}[game]`,
        `[cam][game]vstack=inputs=2,${tail}`,
      ].join(";");
    }
    case "center":
      return `[0:v]${game}${cover(CANVAS_W, CANVAS_H)},${tail}`;
    case "blur": {
      // Fundo: reduz, desfoca e amplia (bem mais rápido que desfocar em 1080x1920).
      return [
        `[0:v]${game}split=2[bgsrc][fgsrc]`,
        `[bgsrc]${cover(270, 480)},boxblur=10:2,scale=${CANVAS_W}:${CANVAS_H}[bg]`,
        `[fgsrc]scale=${CANVAS_W}:-2:flags=lanczos[fg]`,
        `[bg][fg]overlay=(W-w)/2:(H-h)/2,${tail}`,
      ].join(";");
    }
  }
}

/** Ponto (centro) onde as legendas ficam em cada layout. */
export function captionAnchor(opts: LayoutOptions): { x: number; y: number } {
  switch (opts.preset) {
    case "split": {
      // Logo abaixo da emenda webcam/gameplay — região que costuma ter menos HUD.
      const { camH } = splitHeights(opts);
      return { x: CANVAS_W / 2, y: camH + 170 };
    }
    case "center":
      return { x: CANVAS_W / 2, y: Math.round(CANVAS_H * 0.68) };
    case "blur":
      // Abaixo do vídeo 16:9 centralizado (que ocupa ~608px no meio).
      return { x: CANVAS_W / 2, y: Math.round(CANVAS_H * 0.73) };
  }
}
