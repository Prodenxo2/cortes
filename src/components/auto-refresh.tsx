"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renderiza a página do servidor periodicamente (usado enquanto há jobs em andamento). */
export function AutoRefresh({ intervalMs = 4000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
