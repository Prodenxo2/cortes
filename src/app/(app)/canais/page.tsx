import type { Metadata } from "next";
import Link from "next/link";
import { Pause, Play, Radio, Settings2, Trash2, TriangleAlert, Tv } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { focusLabels, parseFocus } from "@/lib/focus";
import { LAYOUT_LABEL } from "@/lib/status";
import { twitchConfigured } from "@/live/twitch-api";
import { ChannelForm } from "@/components/channel-form";
import { addChannelAction, deleteChannelAction, toggleChannelAction, updateChannelAction } from "./actions";

export const metadata: Metadata = { title: "Canais — Cortes" };

const SENSITIVITY = ["", "Só picos enormes", "Equilibrado", "Cortar mais"];

function durationKey(min: number): string {
  return min <= 15 ? "short" : min >= 45 ? "long" : "medium";
}

export default async function ChannelsPage() {
  const user = await requireUser();
  const channels = await prisma.channel.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { projects: true } } },
  });

  const logins = channels.map((c) => c.login);
  const liveNow = await prisma.liveSession.findMany({
    where: { login: { in: logins }, endedAt: null, startedAt: { gte: new Date(Date.now() - 36 * 3600_000) } },
    select: { login: true, title: true, startedAt: true, triggers: true },
  });
  const liveByLogin = new Map(liveNow.map((l) => [l.login, l]));
  const dayAgo = new Date(Date.now() - 24 * 3600_000);
  const recent = await prisma.project.groupBy({
    by: ["channelId"],
    where: { userId: user.id, channelId: { in: channels.map((c) => c.id) }, createdAt: { gte: dayAgo } },
    _count: { _all: true },
  });
  const recentByChannel = new Map(recent.map((r) => [r.channelId, r._count._all]));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Canais monitorados</h1>
        <p className="mt-1 text-zinc-400">
          Quando um desses canais entra ao vivo, a gente acompanha o chat. Se ele explodir de risada ou de hype, o corte é
          feito sozinho e aparece em{" "}
          <Link href="/dashboard" className="text-brand hover:underline">
            Meus cortes
          </Link>{" "}
          alguns minutos depois.
        </p>
      </div>

      {!twitchConfigured() && (
        <div className="flex gap-3 rounded-xl border border-amber-900/60 bg-amber-950/30 p-4 text-sm text-amber-200">
          <TriangleAlert className="h-5 w-5 shrink-0" />
          <p>
            O monitoramento está desligado no servidor: faltam as variáveis <code>TWITCH_CLIENT_ID</code> e{" "}
            <code>TWITCH_CLIENT_SECRET</code>. Você pode cadastrar os canais agora; eles começam a ser monitorados assim
            que as chaves forem configuradas.
          </p>
        </div>
      )}

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
        <h2 className="mb-4 flex items-center gap-2 font-semibold">
          <Tv className="h-4 w-4 text-brand" /> Adicionar canal da Twitch
        </h2>
        <ChannelForm action={addChannelAction} mode="add" />
      </section>

      <section className="space-y-3">
        {channels.length === 0 && (
          <p className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
            Nenhum canal ainda. Adicione o primeiro acima.
          </p>
        )}

        {channels.map((c) => {
          const live = liveByLogin.get(c.login);
          const focus = parseFocus(c.focus);
          return (
            <article key={c.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="flex flex-wrap items-center gap-4">
                {c.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.avatarUrl} alt="" className="h-12 w-12 rounded-full" />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800 text-lg font-bold">
                    {c.login[0]?.toUpperCase()}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={`https://www.twitch.tv/${c.login}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold hover:text-brand"
                    >
                      {c.displayName ?? c.login}
                    </a>
                    {!c.enabled ? (
                      <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">Pausado</span>
                    ) : live ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
                        <Radio className="h-3 w-3 animate-pulse" /> AO VIVO · {live.triggers} pico(s)
                      </span>
                    ) : (
                      <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">Aguardando live</span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs text-zinc-500">
                    {focus.length ? focusLabels(focus).join(", ") : "Qualquer momento forte"} · nota ≥ {c.minScore} ·{" "}
                    {SENSITIVITY[c.sensitivity]} ·
                    até {c.maxClipsPerHour}/h · {LAYOUT_LABEL[c.layoutPreset]} · {c.minClipSeconds}-{c.maxClipSeconds}s
                  </p>
                  <p className="text-xs text-zinc-500">
                    {recentByChannel.get(c.id) ?? 0} corte(s) nas últimas 24h · {c._count.projects} no total
                  </p>
                </div>

                <div className="flex gap-2">
                  <form action={toggleChannelAction.bind(null, c.id)}>
                    <button
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-600"
                      title={c.enabled ? "Pausar monitoramento" : "Retomar monitoramento"}
                    >
                      {c.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      {c.enabled ? "Pausar" : "Retomar"}
                    </button>
                  </form>
                  <form action={deleteChannelAction.bind(null, c.id)}>
                    <button
                      className="inline-flex items-center rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-400 hover:border-red-900 hover:text-red-300"
                      title="Remover canal"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </form>
                </div>
              </div>

              <details className="group mt-3">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
                  <Settings2 className="h-4 w-4" /> Configurações
                </summary>
                <div className="mt-3 border-t border-zinc-800 pt-4">
                  <ChannelForm
                    mode="edit"
                    action={updateChannelAction.bind(null, c.id)}
                    defaults={{
                      login: c.login,
                      layout: c.layoutPreset.toLowerCase(),
                      duration: durationKey(c.minClipSeconds),
                      language: c.language,
                      focus: c.focus,
                      instructions: c.instructions ?? "",
                      sensitivity: String(c.sensitivity),
                      perHour: String(c.maxClipsPerHour),
                      minScore: String(c.minScore),
                    }}
                  />
                </div>
              </details>
            </article>
          );
        })}
      </section>
    </div>
  );
}
