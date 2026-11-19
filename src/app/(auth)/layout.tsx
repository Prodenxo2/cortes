import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Scissors } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2">
          <span className="rounded-lg bg-brand p-1.5 text-black">
            <Scissors className="h-5 w-5" />
          </span>
          <span className="text-xl font-bold tracking-tight">Cortes</span>
        </Link>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 shadow-2xl shadow-black/40">{children}</div>
      </div>
    </main>
  );
}
