"use client";

import { Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

export function SubmitButton({ children, pendingText }: { children: ReactNode; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 font-semibold text-black transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      {pending ? (pendingText ?? "Enviando...") : children}
    </button>
  );
}
