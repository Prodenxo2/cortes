import type { JobStatus, Prisma, Project } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const ACTIVE: JobStatus[] = ["DOWNLOADING", "ANALYZING", "RENDERING"];

/**
 * Reivindica o próximo job QUEUED com update otimista:
 * o UPDATE só vale se a linha ainda estiver QUEUED, então dois workers nunca pegam o mesmo job.
 */
export async function claimNextJob(workerId: string): Promise<Project | null> {
  for (let tries = 0; tries < 5; tries++) {
    const next = await prisma.project.findFirst({
      where: { status: "QUEUED", OR: [{ runAfter: null }, { runAfter: { lte: new Date() } }] },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    if (!next) return null;

    const now = new Date();
    const { count } = await prisma.project.updateMany({
      where: { id: next.id, status: "QUEUED" },
      data: {
        status: "DOWNLOADING",
        progress: 0,
        statusMessage: "Iniciando...",
        error: null,
        lockedBy: workerId,
        lockedAt: now,
        startedAt: now,
        attempts: { increment: 1 },
      },
    });
    if (count === 1) return prisma.project.findUnique({ where: { id: next.id } });
    // outro worker pegou antes — tenta o próximo
  }
  return null;
}

/** Atualiza progresso e renova o heartbeat (lockedAt). */
export async function updateProgress(
  id: string,
  workerId: string,
  data: { status: JobStatus; progress: number; statusMessage: string },
): Promise<void> {
  await prisma.project.updateMany({
    where: { id, lockedBy: workerId },
    data: { ...data, lockedAt: new Date() },
  });
}

export async function completeJob(
  id: string,
  clips: Omit<Prisma.ClipCreateManyInput, "projectId">[],
  meta: { sourceTitle: string; sourceCreator: string | null; sourceDuration: number },
): Promise<void> {
  await prisma.$transaction([
    prisma.clip.deleteMany({ where: { projectId: id } }),
    prisma.clip.createMany({ data: clips.map((c) => ({ ...c, projectId: id })) }),
    prisma.project.update({
      where: { id },
      data: {
        ...meta,
        status: "COMPLETED",
        cancelRequested: false,
        progress: 100,
        statusMessage: `${clips.length} cortes prontos.`,
        lockedBy: null,
        lockedAt: null,
        finishedAt: new Date(),
      },
    }),
  ]);
}

/** Falhou: volta para a fila se ainda houver tentativas, senão marca FAILED. */
export async function failJob(project: Project, error: string): Promise<"requeued" | "failed"> {
  const retry = project.attempts < project.maxAttempts && !isPermanentError(error);
  await prisma.project.update({
    where: { id: project.id },
    data: {
      status: retry ? "QUEUED" : "FAILED",
      statusMessage: retry ? `Erro, nova tentativa (${project.attempts}/${project.maxAttempts})` : "Falhou",
      error: error.slice(0, 60_000),
      lockedBy: null,
      lockedAt: null,
      finishedAt: retry ? null : new Date(),
      // Espera crescente antes de tentar de novo (2, 4, 6... min) — dá tempo de rede/VOD se ajeitarem.
      runAfter: retry ? new Date(Date.now() + project.attempts * 2 * 60_000) : null,
    },
  });
  return retry ? "requeued" : "failed";
}

/** Erros que não adianta repetir (URL inválida, live no ar, vídeo sem áudio...). */
function isPermanentError(msg: string): boolean {
  return /ainda está no ar|BLOQUEIO_YOUTUBE|Vídeo privado|Vídeo indisponível|Unsupported URL|não tem faixa de áudio|GEMINI_API_KEY|404/i.test(
    msg,
  );
}

/** O usuário pediu para pausar (ou cancelou) um job em andamento. */
export async function pauseJob(id: string): Promise<void> {
  await prisma.project.update({
    where: { id },
    data: {
      status: "PAUSED",
      cancelRequested: false,
      progress: 0,
      statusMessage: "Pausado",
      lockedBy: null,
      lockedAt: null,
    },
  });
}

export async function isCancelRequested(id: string): Promise<boolean> {
  const p = await prisma.project.findUnique({ where: { id }, select: { cancelRequested: true } });
  return Boolean(p?.cancelRequested);
}

/**
 * Na subida do container: qualquer job marcado como "em andamento" ficou órfão (o processo anterior
 * morreu no deploy/restart). Como rodamos UM worker por container, devolvemos todos para a fila.
 * Se um dia rodar vários workers em paralelo, desligue com WORKER_REQUEUE_ON_BOOT=0.
 */
export async function requeueOrphansOnBoot(): Promise<number> {
  if (process.env.WORKER_REQUEUE_ON_BOOT === "0") return 0;
  const { count } = await prisma.project.updateMany({
    where: { status: { in: ACTIVE } },
    data: { status: "QUEUED", lockedBy: null, lockedAt: null, progress: 0, statusMessage: "Reiniciado após atualização do servidor" },
  });
  return count;
}

/** Jobs presos (worker morreu no meio): sem heartbeat há X minutos voltam para a fila. */
export async function requeueStaleJobs(staleMinutes: number): Promise<number> {
  const cutoff = new Date(Date.now() - staleMinutes * 60_000);
  const { count } = await prisma.project.updateMany({
    where: { status: { in: ACTIVE }, lockedAt: { lt: cutoff } },
    data: { status: "QUEUED", lockedBy: null, lockedAt: null, statusMessage: "Reenfileirado após travar" },
  });
  return count;
}
