/**
 * Vigia de lives: npm run live
 * Monitora os canais cadastrados, lê o chat e cria cortes automáticos quando o chat explode.
 * Os cortes viram Projects normais, processados pelo worker.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { twitchConfigured } from "./twitch-api";
import { LiveWatcher } from "./watcher";

async function main() {
  if (!twitchConfigured()) {
    console.warn(
      "[live] TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET não configurados — monitoramento de lives DESLIGADO. " +
        "Crie um app em https://dev.twitch.tv/console e coloque as chaves nas variáveis de ambiente.",
    );
    // Fica parado em vez de sair: o start.sh derruba o container se um processo terminar.
    setInterval(() => undefined, 1 << 30);
    return;
  }
  if (typeof WebSocket === "undefined") {
    throw new Error("Este Node não tem WebSocket nativo. Use Node 22 ou mais novo.");
  }

  const watcher = new LiveWatcher();
  await watcher.start();
  console.log("[live] vigia iniciado.");

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, async () => {
      watcher.stop();
      await prisma.$disconnect();
      process.exit(0);
    });
  }
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
