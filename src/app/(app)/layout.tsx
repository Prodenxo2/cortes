import Link from "next/link";
import type { ReactNode } from "react";
import { LogOut, Scissors } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { logoutAction } from "@/app/(auth)/actions";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-zinc-900 bg-[#0b0b0f]/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="rounded-md bg-brand p-1 text-black">
              <Scissors className="h-4 w-4" />
            </span>
            <span className="font-bold tracking-tight">Cortes</span>
          </Link>

          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-zinc-400 sm:inline">{user.name}</span>
            <form action={logoutAction}>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100"
              >
                <LogOut className="h-4 w-4" />
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
