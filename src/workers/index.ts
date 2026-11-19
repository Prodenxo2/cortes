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
import { DiscardedError } from "@/services/pipeline/types";
import type { CropRect, LayoutOptions, LayoutPreset } from "@/services/video/layouts";
import {
  claimNextJob,
  completeJob,
  discardJob,
  failJob,
  isCancelRequested,
  pauseJob,
  requeueOrphansOnBoot,
  requeueStaleJobs,
  updateProgress,
} from "./queue";

const workerId = `${os.hostname()}-${process.pid}`;
const cfg = getConfig();
const analyzer = new GeminiAnalyzer();
/** Quantos projetos processar ao mesmo tempo (render pesa CPU; análise é quase só espera de rede). */
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.WORKER_CONCURRENCY || 2)));
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

  // "Pausar" num job em andamento: o banco marca cancelRequested e aqui a gente interrompe.
  const controller = new AbortController();
  const cancelPoll = setInterval(() => {
    void isCancelRequested(project.id)
      .then((yes) => yes && controller.abort())
      .catch(() => undefined);
  }, 3000);

  try {
    const result = await runPipeline({
      signal: controller.signal,
      jobId: project.id,
      url: project.sourceUrl,
      section: project.section ?? undefined,
      allowLiveVod: Boolean(project.liveSessionId),
      strict: Boolean(project.channelId),
      minViralScore: project.minViralScore ?? undefined,
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
    if (err instanceof DiscardedError) {
      await discardJob(project.id, `Descartado pelo filtro: ${err.message}`);
      log(`job ${project.id} descartado: ${err.message}`);
      return;
    }
    if (controller.signal.aborted) {
      await pauseJob(project.id);
      log(`job ${project.id} pausado pelo usuário`);
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    const outcome = await failJob(project, msg);
    log(`job ${project.id} ${outcome === "requeued" ? "falhou, voltou para a fila" : "FALHOU"}: ${msg}`);
  } finally {
    clearInterval(cancelPoll);
  }
}

async function main() {
  log(`iniciado (${workerId}), modelo ${cfg.gemini.model}, ${CONCURRENCY} job(s) em paralelo`);
  let lastStaleCheck = 0;
  const running = new Set<Promise<void>>();
  const orphans = await requeueOrphansOnBoot().catch(() => 0);
  if (orphans) log(`${orphans} job(s) interrompido(s) pelo último deploy voltaram para a fila`);

  while (!stopping) {
    if (Date.now() - lastStaleCheck > 60_000) {
      lastStaleCheck = Date.now();
      const n = await requeueStaleJobs(cfg.worker.staleMinutes).catch(() => 0);
      if (n) log(`${n} job(s) travado(s) reenfileirado(s)`);
      // Limpeza de sessões de login expiradas.
      await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined);
    }

    if (running.size < CONCURRENCY) {
      const job = await claimNextJob(workerId).catch((err) => {
        log("erro ao buscar job:", err.message);
        return null;
      });
      if (job) {
        const task: Promise<void> = processJob(job).finally(() => running.delete(task));
        running.add(task);
        continue; // já tenta pegar o próximo, se houver vaga
      }
    }
    await sleep(running.size >= CONCURRENCY ? 1000 : cfg.worker.pollMs);
  }

  await Promise.allSettled(running);
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
