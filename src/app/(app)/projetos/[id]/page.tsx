import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, ExternalLink, RotateCcw, Trash2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { isActive, LAYOUT_LABEL, PIPELINE_STEPS, type JobStatusName } from "@/lib/status";
import { focusLabels, parseFocus } from "@/lib/focus";
import { normalizePostPackage } from "@/lib/post";
import { StatusBadge } from "@/components/status-badge";
import { AutoRefresh } from "@/components/auto-refresh";
import { ClipCard } from "@/components/clip-card";
import { deleteProjectAction, retryProjectAction } from "../../actions";
import { QueueControls } from "@/components/queue-controls";

export const metadata: Metadata = { title: "Projeto — Cortes" };

const ORDER: JobStatusName[] = ["QUEUED", "DOWNLOADING", "ANALYZING", "RENDERING", "COMPLETED"];

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const project = await prisma.project.findFirst({
    where: { id, userId: user.id },
    include: { clips: { orderBy: { position: "asc" } } },
  });
  if (!project) notFound();

  const active = isActive(project.status);
  const failed = project.status === "FAILED";
  const currentIdx = ORDER.indexOf(project.status as JobStatusName);

  return (
    <div className="space-y-8">
      {active && <AutoRefresh intervalMs={2500} />}

      <div className="space-y-3">
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-100">
          <ArrowLeft className="h-4 w-4" /> Meus projetos
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">{project.sourceTitle ?? "Processando vídeo..."}</h1>
            <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-400">
              <StatusBadge status={project.status} />
              <span>{LAYOUT_LABEL[project.layoutPreset]}</span>
              <span>
                {project.clipCount} cortes de {project.minClipSeconds}-{project.maxClipSeconds}s
              </span>
              {project.section && <span>trecho {project.section}</span>}
              <span>foco: {parseFocus(project.focus).length ? focusLabels(parseFocus(project.focus)).join(", ") : "automático"}</span>
              <a
                href={project.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-zinc-100"
              >
                vídeo original <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <QueueControls id={project.id} status={project.status} prioritized={project.priority >= 10} />
            {failed && (
              <form action={retryProjectAction.bind(null, project.id)}>
                <button className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-black hover:bg-white">
                  <RotateCcw className="h-4 w-4" /> Tentar de novo
                </button>
              </form>
            )}
            {!(active && project.status !== "QUEUED") && (
              <form action={deleteProjectAction.bind(null, project.id)}>
                <button className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-400 hover:border-red-900 hover:text-red-300">
                  <Trash2 className="h-4 w-4" /> Excluir
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {project.triggerReason && (
        <p className="rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-sm text-zinc-300">
          ⚡ Corte automático da live — {project.triggerReason}
        </p>
      )}

      {project.instructions && !project.triggerReason && (
        <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-400">
          Pedido: <span className="text-zinc-200">{project.instructions}</span>
        </p>
      )}

      {(active || failed) && (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <ol className="mb-5 grid grid-cols-4 gap-2">
            {PIPELINE_STEPS.map((step) => {
              const idx = ORDER.indexOf(step.status);
              const done = !failed && currentIdx > idx;
              const current = !failed && currentIdx === idx;
              return (
                <li key={step.status} className="space-y-2">
                  <div
                    className={`h-1.5 rounded-full ${done ? "bg-brand" : current ? "animate-pulse bg-brand/60" : "bg-zinc-800"}`}
                  />
                  <span
                    className={`flex items-center gap-1 text-xs ${done || current ? "text-zinc-200" : "text-zinc-500"}`}
                  >
                    {done && <Check className="h-3 w-3" />}
                    {step.label}
                  </span>
                </li>
              );
            })}
          </ol>

          {active && (
            <>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-zinc-300">{project.statusMessage ?? "Aguardando na fila..."}</span>
                <span className="font-mono text-zinc-400">{project.progress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full rounded-full bg-brand transition-all duration-700" style={{ width: `${project.progress}%` }} />
              </div>
              {project.status === "QUEUED" && (
                <p className="mt-3 text-xs text-zinc-500">
                  Se ficar parado aqui, confira se o worker está rodando (<code>npm run worker</code>).
                </p>
              )}
            </>
          )}

          {failed && (
            <div className="rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-300">
              <p className="font-medium">Não deu certo.</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-red-300/80">{project.error}</p>
            </div>
          )}
        </section>
      )}

      {project.clips.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">Cortes ({project.clips.length})</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {project.clips.map((c) => (
              <ClipCard
                key={c.id}
                clip={{
                  id: c.id,
                  position: c.position,
                  startTime: c.startTime,
                  endTime: c.endTime,
                  viralScore: c.viralScore,
                  hookTitle: c.hookTitle,
                  hashtags: Array.isArray(c.hashtags) ? (c.hashtags as string[]) : [],
                  reason: c.reason,
                  videoPath: c.videoPath,
                  thumbnailPath: c.thumbnailPath,
                  post: normalizePostPackage(c.post),
                }}
                credit={{ creator: project.sourceCreator, sourceUrl: project.sourceUrl }}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
