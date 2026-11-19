/**
 * "Pacote de postagem" de cada corte: textos prontos por rede.
 * Sem imports de servidor — usado no pipeline, no banco e no card do clipe.
 */

export interface PostPackage {
  /** 3 opções de título (ângulos diferentes: curiosidade, humor, direto). */
  titles: string[];
  tiktok: { caption: string; hashtags: string[] };
  instagram: { caption: string; hashtags: string[] };
  youtube: { title: string; description: string; tags: string[] };
  /** Pergunta para comentário fixado (puxa engajamento). */
  pinned_comment: string;
}

export interface PostCredit {
  /** Nome do canal/streamer (do yt-dlp). */
  creator?: string | null;
  /** Link do VOD original. */
  sourceUrl?: string | null;
}

const clean = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/[\u0000-\u0009\u000b-\u001f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, max);

export function normalizeHashtags(tags: unknown, max = 10): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const tag = String(t).trim().replace(/^#+/, "").replace(/[\s#]+/g, "");
    if (!tag || tag.length > 40) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`#${tag}`);
  }
  return out.slice(0, max);
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out = [...new Set(tags.map((t) => clean(t, 40).replace(/^#+/, "")).filter(Boolean))];
  // O YouTube limita a soma das tags a ~500 caracteres.
  const kept: string[] = [];
  let total = 0;
  for (const t of out) {
    if (total + t.length + 1 > 450) break;
    kept.push(t);
    total += t.length + 1;
  }
  return kept.slice(0, 15);
}

/** Valida/limpa o que veio da IA. Devolve null se não der para aproveitar. */
export function normalizePostPackage(raw: unknown): PostPackage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  const titles = Array.isArray(r.titles) ? r.titles.map((t: unknown) => clean(t, 80)).filter(Boolean).slice(0, 3) : [];
  const pkg: PostPackage = {
    titles,
    tiktok: { caption: clean(r.tiktok?.caption, 300), hashtags: normalizeHashtags(r.tiktok?.hashtags, 5) },
    instagram: { caption: clean(r.instagram?.caption, 1200), hashtags: normalizeHashtags(r.instagram?.hashtags, 10) },
    youtube: {
      title: clean(r.youtube?.title, 90),
      description: clean(r.youtube?.description, 1500),
      tags: normalizeTags(r.youtube?.tags),
    },
    pinned_comment: clean(r.pinned_comment, 200),
  };
  if (pkg.titles.length === 0 && !pkg.tiktok.caption && !pkg.youtube.title) return null;
  return pkg;
}

/** Pacote mínimo a partir do título/hashtags da curadoria (quando a transcrição falha ou no modo single-pass). */
export function fallbackPostPackage(hookTitle: string, hashtags: string[]): PostPackage {
  const tags = normalizeHashtags(hashtags, 10);
  return {
    titles: [hookTitle],
    tiktok: { caption: hookTitle, hashtags: tags.slice(0, 5) },
    instagram: { caption: hookTitle, hashtags: tags },
    youtube: { title: hookTitle.slice(0, 90), description: "", tags: tags.map((t) => t.slice(1)) },
    pinned_comment: "",
  };
}

// ---------------------------------------------------------------- Texto final de cada rede

function creditLine(credit: PostCredit, withLink: boolean): string {
  const who = credit.creator ? `Live de ${credit.creator}` : "Live original";
  if (withLink && credit.sourceUrl) return `🎥 ${who}: ${credit.sourceUrl}`;
  return credit.creator ? `🎥 ${who}` : "";
}

/** Legenda completa do TikTok (link não é clicável lá, então só o nome no crédito). */
export function tiktokText(p: PostPackage, credit: PostCredit): string {
  return [p.tiktok.caption, creditLine(credit, false), p.tiktok.hashtags.join(" ")].filter(Boolean).join("\n\n");
}

export function instagramText(p: PostPackage, credit: PostCredit): string {
  return [p.instagram.caption, creditLine(credit, true), p.instagram.hashtags.join(" ")].filter(Boolean).join("\n\n");
}

/** Título do Short: com #Shorts no fim se couber nos 100 caracteres. */
export function youtubeTitle(p: PostPackage): string {
  const t = p.youtube.title || p.titles[0] || "";
  return /#shorts/i.test(t) || t.length + 8 > 100 ? t : `${t} #Shorts`;
}

export function youtubeDescription(p: PostPackage, credit: PostCredit): string {
  return [p.youtube.description, creditLine(credit, true), "#Shorts"].filter(Boolean).join("\n\n");
}
