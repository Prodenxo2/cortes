"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getDummyHash, hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession } from "@/lib/auth/session";
import { isValidEmail } from "@/lib/validation";

export interface AuthState {
  error?: string;
  email?: string;
  name?: string;
}

export async function signupAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  const keep = { name, email };

  if (name.length < 2 || name.length > 120) return { ...keep, error: "Informe seu nome." };
  if (!isValidEmail(email)) return { ...keep, error: "E-mail inválido." };
  if (password.length < 8) return { ...keep, error: "A senha precisa ter pelo menos 8 caracteres." };
  if (password.length > 200) return { ...keep, error: "Senha longa demais." };
  if (password !== confirm) return { ...keep, error: "As senhas não conferem." };

  let userId: string;
  try {
    const user = await prisma.user.create({
      data: { name, email, passwordHash: await hashPassword(password) },
      select: { id: true },
    });
    userId = user.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ...keep, error: "Já existe uma conta com esse e-mail." };
    }
    throw err;
  }

  await createSession(userId);
  redirect("/dashboard");
}

export async function loginAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const invalid = { email, error: "E-mail ou senha incorretos." };
  if (!email || !password) return invalid;

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, passwordHash: true } });
  // Verifica contra um hash falso quando o e-mail não existe, para não revelar pelo tempo de resposta.
  const ok = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !ok) return invalid;

  await createSession(user.id);
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
