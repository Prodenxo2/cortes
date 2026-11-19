import type { Metadata } from "next";
import Link from "next/link";
import { Film, Zap } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { isActive, LAYOUT_LABEL } from "@/lib/status";
import { NewProjectForm } from "@/components/new-project-form";
import { StatusBadge } from "@/components/status-badge";
import { AutoRefresh } from "@/components/auto-refresh";

export const metadata: Metadata = { title: "Meus cortes — Cortes" };

export default async function DashboardPage() {
  const user = await requireUser();
  const projects = await prisma.project.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      sourceUrl: true,
      sourceTitle: true,
      status: true,
      progress: true,
      statusMessage: true,
      layoutPreset: true,
      createdAt: true,
      triggerReason: true,
      channel: { select: { login: true, displayName: true } },
      clips: { select: { thumbnailPath: true }, orderBy: { position: "asc" }, take: 1 },
      _count: { select: { clips: true } },
    },
  });
  const anyActive = projects.some((p) => isActive(p.status));

  return (
    <div className="space-y-10">
      {anyActive && <AutoRefresh intervalMs={4000} />}
      <NewProjectForm />

      <section>
        <h2 className="mb-4 text-lg font-semibold">Meus projetos</h2>
        {projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 p-10 text-center text-zinc-500">
            <Film className="mx-auto mb-3 h-8 w-8" />
            Nenhum projeto ainda. Cole o link de uma live acima para começar.
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/projetos/${p.id}`}
                  className="group block overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 transition hover:border-zinc-600"
                >
                  <div className="flex aspect-video items-center justify-center bg-zinc-950">
                    {p.clips[0]?.thumbnailPath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.clips[0].thumbnailPath} alt="" className="h-full object-contain" />
                    ) : (
                      <Film className="h-8 w-8 text-zinc-700" />
                    )}
                  </div>
                  <div className="space-y-2 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <StatusBadge status={p.status} />
                      <span className="text-xs text-zinc-500">{p.createdAt.toLocaleDateString("pt-BR")}</span>
                    </div>
                    {p.channel && (
                      <p className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand">
                        <Zap className="h-3 w-3" /> Auto · {p.channel.displayName ?? p.channel.login}
                      </p>
                    )}
                    <p className="line-clamp-2 font-medium group-hover:text-brand">{p.sourceTitle ?? p.sourceUrl}</p>
                    {p.triggerReason && <p className="text-xs text-zinc-500">{p.triggerReason}</p>}
                    <p className="text-xs text-zinc-500">
                      {LAYOUT_LABEL[p.layoutPreset]}
                      {p._count.clips > 0 && ` · ${p._count.clips} cortes`}
                    </p>
                    {isActive(p.status) && (
                      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${p.progress}%` }} />
                      </div>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
