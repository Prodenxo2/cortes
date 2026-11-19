/**
 * Worker de processamento: npm run worker
 * Lê jobs QUEUED do MySQL, roda o pipeline e grava progresso/clipes no banco.
 * Pode rodar mais de uma instância (cada uma pega jobs diferentes).
 */
import "dotenv/config";
import os from "node:os";
import type { JobStatus, Prisma, Project } from "@prisma/client";
import { getConfig } from "@/lib/config";
import { parseFocus } from "@/lib/focus";
import { prisma } from "@/lib/prisma";
import { GeminiAnalyzer } from "@/services/gemini/analyzer";
import { runPipeline } from "@/services/pipeline/run-pipeline";
import type { CropRect, LayoutOptions, LayoutPreset } from "@/services/video/layouts";
import { claimNextJob, completeJob, failJob, requeueStaleJobs, updateProgress } from "./queue";

const workerId = `${os.hostname()}-${process.pid}`;
const cfg = getConfig();
const analyzer = new GeminiAnalyzer();
let stopping = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...args: unknown[]) => console.log(`[worker ${new Date().toLocaleTimeString("pt-BR")}]`, ...args);

function layoutFromProject(p: Project): LayoutOptions {
  const cfgJson = (p.layoutConfig ?? {}) as { webcam?: CropRect; gameplay?: CropRect; camHeightRatio?: number };
  return {
    preset: p.layoutPreset.toLowerCase() as LayoutPreset,
    // Sem webcam salva no projeto = detecção automática por corte.
    webcam: cfgJson.webcam,
    gameplay: cfgJson.gameplay,
    camHeightRatio: cfgJson.camHeightRatio,
  };
}

async function processJob(project: Project) {
  log(`job ${project.id} (tentativa ${project.attempts}/${project.maxAttempts}) ${project.sourceUrl}`);

  // Grava no banco no máximo a cada 2s (e sempre que muda de etapa).
  let lastWrite = 0;
  let lastStage = "";
  const onProgress = async (e: { stage: string; percent: number; message: string }) => {
    const now = Date.now();
    if (e.stage === "COMPLETED") return; // completeJob cuida disso
    if (e.stage === lastStage && now - lastWrite < 2000) return;
    lastWrite = now;
    lastStage = e.stage;
    await updateProgress(project.id, workerId, {
      status: e.stage as JobStatus,
      progress: e.percent,
      statusMessage: e.message.slice(0, 500),
    }).catch((err) => log("falha ao gravar progresso:", err.message));
  };

  try {
    const result = await runPipeline({
      jobId: project.id,
      url: project.sourceUrl,
      section: project.section ?? undefined,
      allowLiveVod: Boolean(project.liveSessionId),
      focus: parseFocus(project.focus),
      instructions: project.instructions ?? undefined,
      layout: layoutFromProject(project),
      minDuration: project.minClipSeconds,
      maxDuration: project.maxClipSeconds,
      clipCount: project.clipCount,
      language: project.language,
      analyzer,
      onProgress,
    });

    await completeJob(
      project.id,
      result.clips.map((c) => ({
        position: c.position,
        startTime: c.start,
        endTime: c.end,
        viralScore: c.viral_score,
        hookTitle: c.hook_title.slice(0, 255),
        hashtags: c.hashtags,
        reason: c.reason,
        captions: c.captions as unknown as Prisma.InputJsonValue,
        layout: c.layout as unknown as Prisma.InputJsonValue,
        webcamMode: c.webcamMode,
        post: c.post as unknown as Prisma.InputJsonValue,
        videoPath: c.publicUrl,
        thumbnailPath: c.thumbnailUrl ?? null,
      })),
      {
        sourceTitle: result.sourceTitle.slice(0, 512),
        sourceCreator: result.sourceCreator?.slice(0, 255) ?? null,
        sourceDuration: result.sourceDuration,
      },
    );
    log(`job ${project.id} concluído: ${result.clips.length} cortes`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const outcome = await failJob(project, msg);
    log(`job ${project.id} ${outcome === "requeued" ? "falhou, voltou para a fila" : "FALHOU"}: ${msg}`);
  }
}

async function main() {
  log(`iniciado (${workerId}), modelo ${cfg.gemini.model}, polling a cada ${cfg.worker.pollMs}ms`);
  let lastStaleCheck = 0;

  while (!stopping) {
    if (Date.now() - lastStaleCheck > 60_000) {
      lastStaleCheck = Date.now();
      const n = await requeueStaleJobs(cfg.worker.staleMinutes).catch(() => 0);
      if (n) log(`${n} job(s) travado(s) reenfileirado(s)`);
      // Limpeza de sessões de login expiradas.
      await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined);
    }

    const job = await claimNextJob(workerId).catch((err) => {
      log("erro ao buscar job:", err.message);
      return null;
    });
    if (job) await processJob(job);
    else await sleep(cfg.worker.pollMs);
  }

  await prisma.$disconnect();
  log("encerrado.");
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (stopping) process.exit(1); // segundo Ctrl+C força a saída
    stopping = true;
    log("encerrando após o job atual (Ctrl+C de novo para forçar)...");
  });
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
