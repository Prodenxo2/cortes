/**
 * Teste de ponta a ponta do pipeline, sem banco de dados.
 *
 *   npm run test:pipeline -- "https://www.youtube.com/watch?v=XXXX"
 *   npm run test:pipeline -- "<URL>" --layout split --cam 0.72,0,0.28,0.3 --min 30 --max 60 --clips 3
 *   npm run test:pipeline -- --file .\meu-video.mp4 --mock      (sem IA, valida só o render)
 *
 * No PowerShell, se as flags sumirem, use: npm.cmd run test:pipeline -- ...   ou   npx tsx scripts/test-pipeline.ts ...
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import path from "node:path";
import { runPipeline } from "@/services/pipeline/run-pipeline";
import { MockAnalyzer } from "@/services/pipeline/mock-analyzer";
import type { ClipAnalyzer } from "@/services/pipeline/types";
import { DEFAULT_WEBCAM, parseRect, type LayoutOptions, type LayoutPreset } from "@/services/video/layouts";
import { formatTimestamp } from "@/lib/time";

const HELP = `
Uso: npm run test:pipeline -- <URL> [opções]

Fonte:
  <URL>                  YouTube ou VOD da Twitch
  --file <caminho>       usa um vídeo local (pula o download)
  --section 00:00-10:00  baixa só esse trecho (recomendado para testar lives longas)

Layout:
  --layout split|center|blur   (default: split)
  (sem --cam a webcam é DETECTADA AUTOMATICAMENTE pelo Gemini em cada corte)
  --cam x,y,w,h          força a região da webcam em frações 0..1 (desliga a detecção)
  --no-detect            não detecta; usa a posição padrão (${Object.values(DEFAULT_WEBCAM).join(",")})
  --no-cam-layout blur|center  layout quando o trecho não tem webcam (default: blur)
  --game x,y,w,h         região da gameplay (default: frame inteiro)
  --cam-height 0.35      fração da altura 9:16 ocupada pela webcam

Cortes:
  --clips 5   --min 30   --max 60   --lang pt-BR

IA:
  --mock                 cortes e legendas falsos (a detecção de webcam continua real se houver GEMINI_API_KEY)
  --single-pass          legendas na mesma chamada da curadoria

Outros:
  --keep                 mantém tmp/jobs/<id> (source.mp4, áudios, .ass)
  --job-id <id>          nome da pasta de saída (default: test-<timestamp>)
`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      file: { type: "string" },
      section: { type: "string" },
      layout: { type: "string", default: "split" },
      cam: { type: "string" },
      game: { type: "string" },
      "cam-height": { type: "string" },
      "no-detect": { type: "boolean", default: false },
      "no-cam-layout": { type: "string", default: "blur" },
      clips: { type: "string", default: "5" },
      min: { type: "string", default: "30" },
      max: { type: "string", default: "60" },
      lang: { type: "string", default: "pt-BR" },
      mock: { type: "boolean", default: false },
      "single-pass": { type: "boolean", default: false },
      keep: { type: "boolean", default: false },
      "job-id": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const url = positionals[0];
  if (values.help || (!url && !values.file)) {
    console.log(HELP);
    process.exit(values.help ? 0 : 1);
  }

  const preset = values.layout as LayoutPreset;
  if (!["split", "center", "blur"].includes(preset)) throw new Error(`--layout inválido: ${preset}`);
  const layout: LayoutOptions = {
    preset,
    webcam: values.cam ? parseRect(values.cam) : undefined,
    gameplay: values.game ? parseRect(values.game) : undefined,
    camHeightRatio: values["cam-height"] ? Number(values["cam-height"]) : undefined,
  };

  const minDuration = Number(values.min);
  const maxDuration = Number(values.max);
  const clipCount = Number(values.clips);
  if (!(minDuration > 0 && maxDuration >= minDuration)) throw new Error("--min/--max inválidos");
  if (!(clipCount >= 1 && clipCount <= 20)) throw new Error("--clips deve ser entre 1 e 20");

  let analyzer: ClipAnalyzer;
  const noCamPreset = values["no-cam-layout"] as "blur" | "center";
  if (!["blur", "center"].includes(noCamPreset)) throw new Error(`--no-cam-layout inválido: ${noCamPreset}`);

  if (values.mock) {
    let detector;
    if (preset === "split" && !values.cam && !values["no-detect"] && process.env.GEMINI_API_KEY) {
      detector = (await import("@/services/gemini/webcam")).detectWebcamWithGemini;
    }
    analyzer = new MockAnalyzer(detector);
  } else {
    // Import dinâmico: o modo --mock funciona mesmo sem a chave/SDK configurados.
    const { GeminiAnalyzer } = await import("@/services/gemini/analyzer");
    analyzer = new GeminiAnalyzer();
  }

  const jobId = values["job-id"] ?? `test-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  console.log(`\n▶ Job ${jobId}  |  analisador: ${analyzer.name}  |  layout: ${preset}\n`);

  const t0 = Date.now();
  let lastLine = "";
  const result = await runPipeline({
    jobId,
    url,
    localFile: values.file,
    section: values.section,
    layout,
    autoDetectWebcam: !values["no-detect"],
    noWebcamPreset: noCamPreset,
    minDuration,
    maxDuration,
    clipCount,
    language: values.lang!,
    singlePass: values["single-pass"],
    keepWorkDir: values.keep,
    analyzer,
    onProgress: ({ stage, percent, message }) => {
      const line = `[${String(percent).padStart(3)}%] ${stage.padEnd(11)} ${message}`;
      if (line !== lastLine) console.log(line);
      lastLine = line;
    },
  });

  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n✔ ${result.clips.length} cortes em ${secs}s — "${result.sourceTitle}"\n`);
  for (const c of result.clips) {
    console.log(`#${c.position}  [${c.viral_score}]  ${formatTimestamp(c.start)} → ${formatTimestamp(c.end)}  ${c.hook_title}`);
    console.log(`    ${c.hashtags.join(" ")}`);
    const cam = c.layout.webcam ? ` cam=${[c.layout.webcam.x, c.layout.webcam.y, c.layout.webcam.w, c.layout.webcam.h].map((n) => n.toFixed(3)).join(",")}` : "";
    console.log(`    layout: ${c.layout.preset} (webcam: ${c.webcamMode})${cam}`);
    console.log(`    ${c.reason}`);
    console.log(`    ${path.relative(process.cwd(), c.filePath)}  (${c.captions.length} legendas)\n`);
  }
  console.log(`Manifesto: ${path.relative(process.cwd(), result.manifestPath)}`);
}

main().catch((err) => {
  console.error(`\n✖ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
