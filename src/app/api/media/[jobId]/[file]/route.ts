import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { getConfig } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".json": "application/json",
};

/**
 * Serve os arquivos de storage/outputs/{jobId}/ só para o dono do projeto.
 * Suporta Range (necessário para o <video> avançar/voltar) e ?download=1.
 */
export async function GET(req: Request, { params }: { params: Promise<{ jobId: string; file: string }> }) {
  const { jobId, file } = await params;

  // Nada de "../": só nomes simples gerados pelo pipeline.
  if (!/^[\w-]+$/.test(jobId) || !/^[\w-]+\.(mp4|jpg|json)$/.test(file)) {
    return new Response("Not found", { status: 404 });
  }

  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const owns = await prisma.project.count({ where: { id: jobId, userId: user.id } });
  if (!owns) return new Response("Not found", { status: 404 });

  const filePath = path.join(getConfig().dirs.outputs, jobId, file);
  let size: number;
  try {
    size = (await fs.promises.stat(filePath)).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers({
    "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  });
  if (new URL(req.url).searchParams.get("download")) {
    headers.set("Content-Disposition", `attachment; filename="${jobId}-${file}"`);
  }

  const range = req.headers.get("range");
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (m && (m[1] || m[2])) {
    let start: number;
    let end: number;
    if (m[1]) {
      start = Number(m[1]);
      end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    } else {
      // "bytes=-500" = últimos 500 bytes
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    }
    if (start >= size || start > end) {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    const stream = fs.createReadStream(filePath, { start, end });
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, { status: 206, headers });
  }

  headers.set("Content-Length", String(size));
  return new Response(Readable.toWeb(fs.createReadStream(filePath)) as unknown as ReadableStream, { status: 200, headers });
}
