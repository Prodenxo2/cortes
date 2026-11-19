import { ArrowUpToLine, Pause, Play } from "lucide-react";
import { pauseProjectAction, prioritizeProjectAction, resumeProjectAction } from "@/app/(app)/actions";
import { isRunning } from "@/lib/status";

/**
 * Botões da fila: Pausar (na fila ou em andamento), Retomar (pausado) e Processar primeiro.
 * Server component: cada botão é um <form> com server action, funciona sem JS.
 */
export function QueueControls({
  id,
  status,
  prioritized,
  compact,
}: {
  id: string;
  status: string;
  prioritized?: boolean;
  compact?: boolean;
}) {
  const queued = status === "QUEUED";
  const paused = status === "PAUSED";
  const running = isRunning(status);
  if (!queued && !paused && !running) {
    return compact ? <div className="h-px rounded-b-2xl border border-t-0 border-zinc-800" /> : null;
  }

  const btn = compact
    ? "inline-flex flex-1 items-center justify-center gap-1.5 px-2 py-2 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
    : "inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-300 transition hover:border-zinc-600";

  return (
    <div
      className={
        compact
          ? "flex divide-x divide-zinc-800 overflow-hidden rounded-b-2xl border border-zinc-800 bg-zinc-900/60"
          : "flex gap-2"
      }
    >
      {(queued || running) && (
        <form action={pauseProjectAction.bind(null, id)} className={compact ? "flex flex-1" : ""}>
          <button className={btn} title={running ? "Interrompe e deixa pausado (recomeça do zero ao retomar)" : "Tira da fila"}>
            <Pause className="h-3.5 w-3.5" /> Pausar
          </button>
        </form>
      )}
      {paused && (
        <form action={resumeProjectAction.bind(null, id)} className={compact ? "flex flex-1" : ""}>
          <button className={btn}>
            <Play className="h-3.5 w-3.5" /> Retomar
          </button>
        </form>
      )}
      {(queued || paused) && !prioritized && (
        <form action={prioritizeProjectAction.bind(null, id)} className={compact ? "flex flex-1" : ""}>
          <button className={btn} title="Passa na frente da fila">
            <ArrowUpToLine className="h-3.5 w-3.5" /> Processar primeiro
          </button>
        </form>
      )}
    </div>
  );
}
