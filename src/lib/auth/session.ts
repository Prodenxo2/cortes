import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE = "cortes_session";
const SESSION_DAYS = 30;

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** Cria a sessão no banco e grava o cookie. Só pode ser chamada em Server Action / Route Handler. */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const userAgent = (await headers()).get("user-agent")?.slice(0, 255) ?? null;

  await prisma.session.create({ data: { tokenHash: sha256(token), userId, userAgent, expiresAt } });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/** Usuário logado (ou null). Memoizado por request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    select: { expiresAt: true, user: { select: { id: true, name: true, email: true } } },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
});

/** Para páginas protegidas: devolve o usuário ou manda para o login. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  store.delete(SESSION_COOKIE);
}
