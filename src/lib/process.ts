import { spawn } from "node:child_process";

export class CommandError extends Error {
  constructor(
    message: string,
    public readonly bin: string,
    public readonly code: number | null,
    public readonly stderrTail: string,
  ) {
    super(message);
    this.name = "CommandError";
  }
}

export interface RunOptions {
  cwd?: string;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  signal?: AbortSignal;
  /** Guarda o stdout completo (desligue para saídas enormes). Default: true */
  captureStdout?: boolean;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

const TAIL_LIMIT = 16_000;

/**
 * Executa um binário sem shell (argumentos passados como array, sem problemas de aspas no Windows).
 * Rejeita com CommandError se o processo sair com código != 0.
 */
export function runCommand(bin: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      signal: opts.signal,
    });

    let stdout = "";
    let stderr = "";
    let outBuf = "";
    let errBuf = "";
    const capture = opts.captureStdout !== false;

    const flushLines = (buf: string, cb?: (l: string) => void): string => {
      const lines = buf.split(/\r?\n|\r/);
      const rest = lines.pop() ?? "";
      if (cb) for (const l of lines) if (l.trim()) cb(l);
      return rest;
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      if (capture) stdout += chunk;
      outBuf = flushLines(outBuf + chunk, opts.onStdoutLine);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-TAIL_LIMIT);
      errBuf = flushLines(errBuf + chunk, opts.onStderrLine);
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(
          new CommandError(
            `"${bin}" não encontrado. Verifique o PATH (rode: npm run check:deps) ou defina o caminho no .env.`,
            bin,
            null,
            "",
          ),
        );
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
      if (outBuf.trim()) opts.onStdoutLine?.(outBuf);
      if (errBuf.trim()) opts.onStderrLine?.(errBuf);
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        const tail = stderr.trim().split(/\r?\n/).slice(-15).join("\n");
        reject(new CommandError(`${bin} saiu com código ${code}:\n${tail}`, bin, code, tail));
      }
    });
  });
}
