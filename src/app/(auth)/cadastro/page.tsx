import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Criar conta — Cortes" };

export default function SignupPage() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Criar conta</h1>
      <p className="mb-6 text-sm text-zinc-400">Cole o link da live e receba os cortes prontos.</p>
      <AuthForm mode="signup" />
    </>
  );
}
