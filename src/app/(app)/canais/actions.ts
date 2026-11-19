"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { MAX_INSTRUCTIONS, parseFocus, sanitizeInstructions } from "@/lib/focus";
import { getUsers, normalizeTwitchLogin, twitchConfigured } from "@/live/twitch-api";

const MAX_CHANNELS_PER_USER = 10;

const DURATIONS: Record<string, [number, number]> = {
  short: [15, 30],
  medium: [20, 60],
  long: [45, 90],
};

export interface ChannelFormState {
  error?: string;
  ok?: string;
  values?: Record<string, string>;
}

const FIELDS = ["login", "layout", "duration", "language", "focus", "instructions", "sensitivity", "perHour"];

function parseSettings(values: Record<string, string>) {
  const layout = values.layout.toUpperCase();
  if (!["SPLIT", "CENTER", "BLUR"].includes(layout)) return { error: "Layout inválido." };
  const range = DURATIONS[values.duration];
  if (!range) return { error: "Duração inválida." };
  const sensitivity = Number(values.sensitivity);
  if (![1, 2, 3].includes(sensitivity)) return { error: "Sensibilidade inválida." };
  const perHour = Number(values.perHour);
  if (![4, 8, 12, 20].includes(perHour)) return { error: "Limite por hora inválido." };
  if (values.instructions.length > MAX_INSTRUCTIONS) {
    return { error: `O pedido extra pode ter no máximo ${MAX_INSTRUCTIONS} caracteres.` };
  }
  return {
    data: {
      layoutPreset: layout as "SPLIT" | "CENTER" | "BLUR",
      minClipSeconds: range[0],
      maxClipSeconds: range[1],
      language: ["pt-BR", "en", "es"].includes(values.language) ? values.language : "pt-BR",
      focus: parseFocus(values.focus).join(","),
      instructions: sanitizeInstructions(values.instructions) || null,
      sensitivity,
      maxClipsPerHour: perHour,
    },
  };
}

const readValues = (form: FormData) => Object.fromEntries(FIELDS.map((k) => [k, String(form.get(k) ?? "")]));

export async function addChannelAction(_prev: ChannelFormState, form: FormData): Promise<ChannelFormState> {
  const user = await requireUser();
  const values = readValues(form);
  const fail = (error: string): ChannelFormState => ({ error, values });

  const login = normalizeTwitchLogin(values.login);
  if (!login) return fail("Canal inválido. Use o nome do canal (ex: gaules) ou o link twitch.tv/gaules.");

  const settings = parseSettings(values);
  if ("error" in settings) return fail(settings.error!);

  const count = await prisma.channel.count({ where: { userId: user.id } });
  if (count >= MAX_CHANNELS_PER_USER) return fail(`Você pode monitorar até ${MAX_CHANNELS_PER_USER} canais.`);

  let displayName: string | null = null;
  let avatarUrl: string | null = null;
  if (twitchConfigured()) {
    const [tw] = await getUsers([login]).catch(() => []);
    if (!tw) return fail(`Não achei o canal "${login}" na Twitch.`);
    displayName = tw.display_name;
    avatarUrl = tw.profile_image_url;
  }

  try {
    await prisma.channel.create({
      data: { userId: user.id, platform: "twitch", login, displayName, avatarUrl, ...settings.data },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return fail("Você já monitora esse canal.");
    }
    throw err;
  }

  revalidatePath("/canais");
  return { ok: `Canal ${displayName ?? login} adicionado. Os cortes automáticos começam na próxima live.` };
}

async function ownChannel(id: string) {
  const user = await requireUser();
  const ch = await prisma.channel.findFirst({ where: { id, userId: user.id } });
  if (!ch) throw new Error("Canal não encontrado.");
  return ch;
}

export async function updateChannelAction(
  id: string,
  _prev: ChannelFormState,
  form: FormData,
): Promise<ChannelFormState> {
  await ownChannel(id);
  const values = readValues(form);
  const settings = parseSettings(values);
  if ("error" in settings) return { error: settings.error, values };
  await prisma.channel.update({ where: { id }, data: settings.data });
  revalidatePath("/canais");
  return { ok: "Configurações salvas.", values };
}

export async function toggleChannelAction(id: string): Promise<void> {
  const ch = await ownChannel(id);
  await prisma.channel.update({ where: { id }, data: { enabled: !ch.enabled } });
  revalidatePath("/canais");
}

export async function deleteChannelAction(id: string): Promise<void> {
  await ownChannel(id);
  await prisma.channel.delete({ where: { id } });
  revalidatePath("/canais");
}
