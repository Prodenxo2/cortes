"use client";

import { useState } from "react";
import { Check, Copy, Download, Flame, MessageCircle } from "lucide-react";
import {
  instagramText,
  tiktokText,
  youtubeDescription,
  youtubeTitle,
  type PostCredit,
  type PostPackage,
} from "@/lib/post";

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
  post: PostPackage | null;
}

type Platform = "tiktok" | "instagram" | "youtube";
const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "tiktok", label: "TikTok" },
  { id: "instagram", label: "Instagram" },
  { id: "youtube", label: "YouTube" },
];

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

function CopyButton({ text, label, compact }: { text: string; label: string; compact?: boolean }) {
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
      title={label}
    >
      {done ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      {!compact && (done ? "Copiado" : "Copiar")}
    </button>
  );
}

function TextBlock({ title, text, copyLabel }: { title?: string; text: string; copyLabel: string }) {
  if (!text) return null;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60">
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-3 py-1.5">
        <span className="text-xs text-zinc-500">{title}</span>
        <CopyButton text={text} label={copyLabel} />
      </div>
      <p className="whitespace-pre-wrap break-words px-3 py-2 text-sm text-zinc-200">{text}</p>
    </div>
  );
}

export function ClipCard({ clip, credit }: { clip: ClipCardData; credit: PostCredit }) {
  const [tab, setTab] = useState<Platform>("tiktok");
  const duration = Math.round(clip.endTime - clip.startTime);
  const post = clip.post;
  const titles = post?.titles.length ? post.titles : [clip.hookTitle];

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

      <div className="flex flex-1 flex-col gap-4 p-4">
        {/* Opções de título */}
        <div className="space-y-1.5">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Títulos</p>
          <ul className="space-y-1">
            {titles.map((t, i) => (
              <li key={i} className="flex items-start justify-between gap-2">
                <span className={`text-sm leading-snug ${i === 0 ? "font-semibold" : "text-zinc-300"}`}>{t}</span>
                <CopyButton text={t} label="Copiar título" compact />
              </li>
            ))}
          </ul>
        </div>

        {post ? (
          <div className="space-y-2">
            <div className="flex gap-1 rounded-lg bg-zinc-950 p-1">
              {PLATFORMS.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => setTab(p.id)}
                  className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${
                    tab === p.id ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {tab === "tiktok" && <TextBlock title="Legenda" text={tiktokText(post, credit)} copyLabel="Copiar legenda do TikTok" />}
            {tab === "instagram" && (
              <TextBlock title="Legenda" text={instagramText(post, credit)} copyLabel="Copiar legenda do Instagram" />
            )}
            {tab === "youtube" && (
              <div className="space-y-2">
                <TextBlock title="Título" text={youtubeTitle(post)} copyLabel="Copiar título do YouTube" />
                <TextBlock
                  title="Descrição"
                  text={youtubeDescription(post, credit)}
                  copyLabel="Copiar descrição do YouTube"
                />
                {post.youtube.tags.length > 0 && (
                  <TextBlock title="Tags" text={post.youtube.tags.join(", ")} copyLabel="Copiar tags do YouTube" />
                )}
              </div>
            )}

            {post.pinned_comment && (
              <div className="flex items-start justify-between gap-2 rounded-lg border border-dashed border-zinc-800 px-3 py-2">
                <span className="flex items-start gap-2 text-sm text-zinc-300">
                  <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
                  {post.pinned_comment}
                </span>
                <CopyButton text={post.pinned_comment} label="Copiar comentário fixado" compact />
              </div>
            )}
          </div>
        ) : (
          clip.hashtags.length > 0 && (
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm text-brand/90">{clip.hashtags.join(" ")}</p>
              <CopyButton text={clip.hashtags.join(" ")} label="Copiar hashtags" />
            </div>
          )
        )}

        <p className="text-xs text-zinc-500">{clip.reason}</p>

        <div className="mt-auto flex items-center justify-between pt-1 text-xs text-zinc-500">
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
