import path from "node:path";
import { FileState, type File as GeminiFile } from "@google/genai";
import { getGenAI, withRetry } from "./client";

export interface ActiveFile {
  name: string;
  uri: string;
  mimeType: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sobe um arquivo pela Gemini File API e espera ficar ACTIVE.
 * Áudio normalmente já volta ACTIVE; vídeo passa por PROCESSING.
 */
export async function uploadAndWaitActive(
  filePath: string,
  mimeType: string,
  opts: { timeoutMs?: number; onStatus?: (msg: string) => void } = {},
): Promise<ActiveFile> {
  const ai = getGenAI();
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;

  opts.onStatus?.(`Enviando ${path.basename(filePath)} para a Gemini File API...`);
  let file: GeminiFile = await withRetry(
    () => ai.files.upload({ file: filePath, config: { mimeType, displayName: path.basename(filePath) } }),
    "files.upload",
  );
  if (!file.name) throw new Error("[gemini] upload não retornou o nome do arquivo.");
  const name = file.name;

  const deadline = Date.now() + timeoutMs;
  let polls = 0;
  for (;;) {
    if (file.state === FileState.ACTIVE) break;
    if (file.state === FileState.FAILED) {
      throw new Error(`[gemini] processamento do arquivo falhou: ${file.error?.message ?? "sem detalhes"}`);
    }
    // Estado não especificado depois de um GET: segue e deixa o generateContent validar.
    if (file.state !== FileState.PROCESSING && polls > 0) break;
    if (Date.now() > deadline) throw new Error(`[gemini] arquivo ${name} não ficou ACTIVE em ${timeoutMs / 1000}s.`);

    opts.onStatus?.("Aguardando o Gemini processar o arquivo...");
    await sleep(2_000);
    file = await withRetry(() => ai.files.get({ name }), "files.get");
    polls++;
  }

  if (!file.uri) throw new Error(`[gemini] arquivo ${name} sem URI.`);
  return { name, uri: file.uri, mimeType: file.mimeType ?? mimeType };
}

/** Remove o arquivo da File API. Nunca lança (limpeza não pode derrubar o job). */
export async function deleteFileQuietly(name: string): Promise<void> {
  try {
    await getGenAI().files.delete({ name });
  } catch (err) {
    console.warn(`[gemini] não consegui apagar ${name}: ${(err as Error).message}`);
  }
}
