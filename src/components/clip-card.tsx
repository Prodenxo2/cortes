"use client";

import { useState } from "react";
import { Check, Copy, Download, Flame } from "lucide-react";

export interface ClipCardData {
  id: string;
  position: number;
  startTime: number;
  endTime: number;
  viralScore: number;
  hookTitle: string;
  hashtags: string[];
  reason: string;
  videoPath: string;
  thumbnailPath: string | null;
}

function fmt(sec: number): string {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function scoreClass(score: number): string {
  if (score >= 85) return "bg-emerald-500 text-black";
  if (score >= 70) return "bg-brand text-black";
  if (score >= 50) return "bg-amber-600 text-black";
  return "bg-zinc-700 text-zinc-100";
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
      aria-label={label}
    >
      {done ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? "Copiado" : "Copiar"}
    </button>
  );
}

export function ClipCard({ clip }: { clip: ClipCardData }) {
  const tags = clip.hashtags.join(" ");
  const duration = Math.round(clip.endTime - clip.startTime);

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40">
      <div className="relative bg-black">
        <video
          src={clip.videoPath}
          poster={clip.thumbnailPath ?? undefined}
          controls
          preload="metadata"
          playsInline
          className="aspect-[9/16] w-full object-contain"
        />
        <span
          className={`absolute left-3 top-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${scoreClass(clip.viralScore)}`}
          title="Nota de viralidade"
        >
          <Flame className="h-3.5 w-3.5" />
          {clip.viralScore}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold leading-snug">{clip.hookTitle}</h3>
          <CopyButton text={clip.hookTitle} label="Copiar título" />
        </div>

        {tags && (
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-brand/90">{tags}</p>
            <CopyButton text={tags} label="Copiar hashtags" />
          </div>
        )}

        <p className="text-sm text-zinc-400">{clip.reason}</p>

        <div className="mt-auto flex items-center justify-between pt-2 text-xs text-zinc-500">
          <span>
            #{clip.position} · {fmt(clip.startTime)} → {fmt(clip.endTime)} · {duration}s
          </span>
          <a
            href={`${clip.videoPath}?download=1`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-black transition hover:bg-white"
          >
            <Download className="h-4 w-4" />
            Baixar
          </a>
        </div>
      </div>
    </article>
  );
}
