/**
 * Gera um JPG de 1 frame com o layout 9:16, para conferir o enquadramento antes de renderizar.
 *
 *   npm run preview:layout -- .\tmp\jobs\<id>\source.mp4 --at 120 --auto        (Gemini acha a webcam)
 *   npm run preview:layout -- .\tmp\jobs\<id>\source.mp4 --at 120 --cam 0.72,0,0.28,0.3
 *   (rode o test:pipeline com --keep para ter o source.mp4 guardado)
 */
import "dotenv/config";
import fs from "node:fs/promises";
import os from "node:os";
import { parseArgs } from "node:util";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { runCommand } from "@/lib/process";
import { parseTimestamp } from "@/lib/time";
import { extractFrame, probe } from "@/services/video/ffmpeg";
import {
  autoCamHeightRatio,
  buildFilterGraph,
  DEFAULT_WEBCAM,
  parseRect,
  type LayoutOptions,
  type LayoutPreset,
} from "@/services/video/layouts";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      layout: { type: "string", default: "split" },
      cam: { type: "string" },
      game: { type: "string" },
      "cam-height": { type: "string" },
      auto: { type: "boolean", default: false },
      at: { type: "string", default: "10" },
      out: { type: "string" },
    },
  });
  const file = positionals[0];
  if (!file) {
    console.log("Uso: npm run preview:layout -- <video.mp4> [--at 00:02:00] [--auto | --cam x,y,w,h] [--layout split]");
    process.exit(1);
  }

  const src = path.resolve(file);
  const info = await probe(src);
  const at = Math.min(parseTimestamp(values.at!), Math.max(0, info.duration - 1));

  let layout: LayoutOptions = {
    preset: values.layout as LayoutPreset,
    webcam: values.cam ? parseRect(values.cam) : undefined,
    gameplay: values.game ? parseRect(values.game) : undefined,
    camHeightRatio: values["cam-height"] ? Number(values["cam-height"]) : undefined,
  };

  if (values.auto) {
    const { detectWebcamWithGemini } = await import("@/services/gemini/webcam");
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cortes-cam-"));
    const times = [at - 5, at, at + 5].map((t) => Math.min(Math.max(0, t), info.duration - 0.5));
    const frames = await Promise.all(times.map((t, i) => extractFrame(src, t, path.join(tmp, `f${i}.jpg`), 960)));
    const det = await detectWebcamWithGemini(frames);
    await fs.rm(tmp, { recursive: true, force: true });

    console.log(`Detecção: ${det.kind} (confiança ${det.confidence.toFixed(2)})`);
    if (det.kind === "overlay") {
      layout = { ...layout, preset: "split", webcam: det.rect };
      const r = det.rect;
      console.log(`--cam ${[r.x, r.y, r.w, r.h].map((n) => n.toFixed(3)).join(",")}`);
    } else if (det.kind === "fullscreen_cam") {
      layout = { preset: "center", gameplay: det.rect };
    } else {
      layout = { preset: "blur", gameplay: layout.gameplay };
    }
  }

  if (layout.preset === "split") {
    const cam = layout.webcam ?? DEFAULT_WEBCAM;
    layout = { ...layout, webcam: cam, camHeightRatio: layout.camHeightRatio ?? autoCamHeightRatio(cam, info.width, info.height) };
  }

  const out = path.resolve(values.out ?? "preview-layout.jpg");
  await runCommand(getConfig().bins.ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-ss", at.toFixed(3),
    "-i", src,
    "-filter_complex", buildFilterGraph(layout),
    "-map", "[vout]",
    "-frames:v", "1",
    "-q:v", "2",
    out,
  ]);
  console.log(`Preview (${layout.preset}) salvo em ${out}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
