/** Rótulos e etapas do job — compartilhado entre server e client (sem imports do Prisma). */

export type JobStatusName =
  | "QUEUED"
  | "DOWNLOADING"
  | "ANALYZING"
  | "RENDERING"
  | "COMPLETED"
  | "FAILED"
  | "PAUSED"
  | "DISCARDED";

export const STATUS_LABEL: Record<JobStatusName, string> = {
  QUEUED: "Na fila",
  DOWNLOADING: "Baixando",
  ANALYZING: "Analisando com Gemini",
  RENDERING: "Renderizando cortes",
  COMPLETED: "Concluído",
  FAILED: "Falhou",
  PAUSED: "Pausado",
  DISCARDED: "Descartado",
};

export const PIPELINE_STEPS: { status: JobStatusName; label: string }[] = [
  { status: "DOWNLOADING", label: "Download" },
  { status: "ANALYZING", label: "Análise com Gemini" },
  { status: "RENDERING", label: "Renderização" },
  { status: "COMPLETED", label: "Pronto" },
];

export const ACTIVE_STATUSES: JobStatusName[] = ["QUEUED", "DOWNLOADING", "ANALYZING", "RENDERING"];

/** Processando agora (não inclui fila nem pausado). */
export const RUNNING_STATUSES: JobStatusName[] = ["DOWNLOADING", "ANALYZING", "RENDERING"];

export function isRunning(status: string): boolean {
  return (RUNNING_STATUSES as string[]).includes(status);
}

export function isActive(status: string): boolean {
  return (ACTIVE_STATUSES as string[]).includes(status);
}

export const LAYOUT_LABEL: Record<string, string> = {
  SPLIT: "Webcam + gameplay",
  CENTER: "Tela cheia (crop central)",
  BLUR: "16:9 com fundo desfocado",
};
