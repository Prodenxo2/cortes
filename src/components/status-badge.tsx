import { Ban, CheckCircle2, Clock, Loader2, PauseCircle, XCircle } from "lucide-react";
import { STATUS_LABEL, type JobStatusName } from "@/lib/status";

const STYLE: Record<JobStatusName, string> = {
  QUEUED: "bg-zinc-800 text-zinc-300",
  DOWNLOADING: "bg-sky-950 text-sky-300",
  ANALYZING: "bg-violet-950 text-violet-300",
  RENDERING: "bg-amber-950 text-amber-300",
  COMPLETED: "bg-emerald-950 text-emerald-300",
  FAILED: "bg-red-950 text-red-300",
  PAUSED: "bg-zinc-800 text-zinc-400",
  DISCARDED: "bg-zinc-900 text-zinc-500",
};

export function StatusBadge({ status }: { status: JobStatusName }) {
  const Icon =
    status === "COMPLETED"
      ? CheckCircle2
      : status === "FAILED"
        ? XCircle
        : status === "QUEUED"
          ? Clock
          : status === "PAUSED"
            ? PauseCircle
            : status === "DISCARDED"
              ? Ban
              : Loader2;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STYLE[status]}`}>
      <Icon className={`h-3.5 w-3.5 ${Icon === Loader2 ? "animate-spin" : ""}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}
