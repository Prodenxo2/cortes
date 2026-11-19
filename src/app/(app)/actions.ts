"use server";

import fs from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getConfig } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { ACTIVE_STATUSES } from "@/lib/status";
import { normalizeSection, normalizeSourceUrl } from "@/lib/validation";

/** Quantos jobs (na fila ou processando) cada usuário pode ter ao mesmo tempo. */
const MAX_ACTIVE_PER_USER = 2;

const DURATIONS: Record<string, [number, number]> = {
  short: [15, 30],
  medium: [30, 60],
  long: [60, 90],
};

export interface NewProjectState {
  error?: string;
  values?: Record<string, string>;
}

export async function createProjectAction(_prev: NewProjectState, form: FormData): Promise<NewProjectState> {
  const user = await requireUser();
  const values = Object.fromEntries(
    ["url", "layout", "duration", "clips", "language", "section"].map((k) => [k, String(form.get(k) ?? "")]),
  );
  const fail = (error: string): NewProjectState => ({ error, values });

  const url = normalizeSourceUrl(values.url);
  if (!url) return fail("Link inválido. Use um vídeo do YouTube (youtube.com/watch?v=...) ou VOD da Twitch (twitch.tv/videos/...).");

  const layout = values.layout.toUpperCase();
  if (!["SPLIT", "CENTER", "BLUR"].includes(layout)) return fail("Layout inválido.");

  const range = DURATIONS[values.duration];
  if (!range) return fail("Duração inválida.");

  const clips = Number(values.clips);
  if (!Number.isInteger(clips) || clips < 1 || clips > 10) return fail("Escolha de 1 a 10 cortes.");

  const language = ["pt-BR", "en", "es"].includes(values.language) ? values.language : "pt-BR";

  const section = normalizeSection(values.section);
  if (section.error) return fail(section.error);

  const active = await prisma.project.count({
    where: { userId: user.id, status: { in: ACTIVE_STATUSES } },
  });
  if (active >= MAX_ACTIVE_PER_USER) {
    return fail(`Você já tem ${active} processamento(s) em andamento. Espere terminar para enviar outro.`);
  }

  const project = await prisma.project.create({
    data: {
      userId: user.id,
      sourceUrl: url,
      layoutPreset: layout as "SPLIT" | "CENTER" | "BLUR",
      minClipSeconds: range[0],
      maxClipSeconds: range[1],
      clipCount: clips,
      language,
      section: section.value,
    },
    select: { id: true },
  });

  revalidatePath("/dashboard");
  redirect(`/projetos/${project.id}`);
}

/** Só permite mexer em projetos do próprio usuário. */
async function ownProject(id: string) {
  const user = await requireUser();
  const project = await prisma.project.findFirst({ where: { id, userId: user.id } });
  if (!project) throw new Error("Projeto não encontrado.");
  return project;
}

export async function retryProjectAction(id: string): Promise<void> {
  const project = await ownProject(id);
  if (project.status !== "FAILED") return;
  await prisma.project.update({
    where: { id },
    data: { status: "QUEUED", attempts: 0, error: null, progress: 0, statusMessage: "Na fila", finishedAt: null },
  });
  revalidatePath(`/projetos/${id}`);
  revalidatePath("/dashboard");
}

export async function deleteProjectAction(id: string): Promise<void> {
  const project = await ownProject(id);
  if (["DOWNLOADING", "ANALYZING", "RENDERING"].includes(project.status)) {
    throw new Error("Não dá para excluir enquanto está processando.");
  }
  await prisma.project.delete({ where: { id } });
  const dir = path.join(getConfig().dirs.outputs, id);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  revalidatePath("/dashboard");
  redirect("/dashboard");
}
