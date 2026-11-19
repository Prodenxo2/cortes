/** Rótulos e etapas do job — compartilhado entre server e client (sem imports do Prisma). */

export type JobStatusName = "QUEUED" | "DOWNLOADING" | "ANALYZING" | "RENDERING" | "COMPLETED" | "FAILED";

export const STATUS_LABEL: Record<JobStatusName, string> = {
  QUEUED: "Na fila",
  DOWNLOADING: "Baixando",
  ANALYZING: "Analisando com Gemini",
  RENDERING: "Renderizando cortes",
  COMPLETED: "Concluído",
  FAILED: "Falhou",
};

export const PIPELINE_STEPS: { status: JobStatusName; label: string }[] = [
  { status: "DOWNLOADING", label: "Download" },
  { status: "ANALYZING", label: "Análise com Gemini" },
  { status: "RENDERING", label: "Renderização" },
  { status: "COMPLETED", label: "Pronto" },
];

export const ACTIVE_STATUSES: JobStatusName[] = ["QUEUED", "DOWNLOADING", "ANALYZING", "RENDERING"];

export function isActive(status: string): boolean {
  return (ACTIVE_STATUSES as string[]).includes(status);
}

export const LAYOUT_LABEL: Record<string, string> = {
  SPLIT: "Webcam + gameplay",
  CENTER: "Tela cheia (crop central)",
  BLUR: "16:9 com fundo desfocado",
};
