import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Entrar — Cortes" };

export default function LoginPage() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Entrar</h1>
      <p className="mb-6 text-sm text-zinc-400">Acesse seus cortes.</p>
      <AuthForm mode="login" />
    </>
  );
}
