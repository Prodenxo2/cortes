"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction, signupAction, type AuthState } from "@/app/(auth)/actions";
import { SubmitButton } from "./submit-button";

const input =
  "w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm outline-none transition placeholder:text-zinc-600 focus:border-brand";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const isSignup = mode === "signup";
  const [state, action] = useActionState<AuthState, FormData>(isSignup ? signupAction : loginAction, {});

  return (
    <form action={action} className="space-y-4">
      {isSignup && (
        <label className="block space-y-1.5">
          <span className="text-sm text-zinc-400">Nome</span>
          <input name="name" required minLength={2} defaultValue={state.name} className={input} placeholder="Seu nome" />
        </label>
      )}

      <label className="block space-y-1.5">
        <span className="text-sm text-zinc-400">E-mail</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          defaultValue={state.email}
          className={input}
          placeholder="voce@email.com"
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm text-zinc-400">Senha</span>
        <input
          name="password"
          type="password"
          required
          minLength={isSignup ? 8 : undefined}
          autoComplete={isSignup ? "new-password" : "current-password"}
          className={input}
          placeholder={isSignup ? "Mínimo 8 caracteres" : "••••••••"}
        />
      </label>

      {isSignup && (
        <label className="block space-y-1.5">
          <span className="text-sm text-zinc-400">Confirmar senha</span>
          <input name="confirm" type="password" required autoComplete="new-password" className={input} />
        </label>
      )}

      {state.error && (
        <p role="alert" className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {state.error}
        </p>
      )}

      <SubmitButton pendingText={isSignup ? "Criando conta..." : "Entrando..."}>
        {isSignup ? "Criar conta" : "Entrar"}
      </SubmitButton>

      <p className="text-center text-sm text-zinc-500">
        {isSignup ? (
          <>
            Já tem conta?{" "}
            <Link href="/login" className="text-brand hover:underline">
              Entrar
            </Link>
          </>
        ) : (
          <>
            Não tem conta?{" "}
            <Link href="/cadastro" className="text-brand hover:underline">
              Criar conta grátis
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
