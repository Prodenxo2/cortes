import Link from "next/link";
import { redirect } from "next/navigation";
import { Download, Scissors, Sparkles, Subtitles } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";

const FEATURES = [
  { icon: Sparkles, title: "IA escolhe os momentos", text: "O Gemini ouve a live e acha os picos de risada, susto e treta." },
  { icon: Scissors, title: "9:16 automático", text: "Webcam detectada sozinha no topo, gameplay embaixo." },
  { icon: Subtitles, title: "Legenda dinâmica", text: "Frase a frase, com a palavra-chave em destaque." },
  { icon: Download, title: "Pronto para postar", text: "MP4 1080x1920 + título, hashtags e nota de viralidade." },
];

export default async function Home() {
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6">
      <header className="flex h-16 items-center justify-between">
        <span className="flex items-center gap-2">
          <span className="rounded-md bg-brand p-1 text-black">
            <Scissors className="h-4 w-4" />
          </span>
          <span className="font-bold tracking-tight">Cortes</span>
        </span>
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/login" className="rounded-lg px-3 py-1.5 text-zinc-300 hover:bg-zinc-900">
            Entrar
          </Link>
          <Link href="/cadastro" className="rounded-lg bg-brand px-3 py-1.5 font-semibold text-black hover:brightness-110">
            Criar conta
          </Link>
        </nav>
      </header>

      <section className="flex flex-1 flex-col justify-center py-20">
        <h1 className="max-w-3xl text-4xl font-black leading-tight tracking-tight sm:text-6xl">
          Sua live vira <span className="text-brand">cortes virais</span> enquanto você dorme.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-zinc-400">
          Cole o link do VOD do YouTube ou da Twitch. A gente encontra os melhores momentos, monta o vertical com
          legenda e entrega pronto para TikTok e Shorts.
        </p>
        <div className="mt-10">
          <Link
            href="/cadastro"
            className="inline-flex rounded-xl bg-brand px-6 py-3 text-lg font-bold text-black transition hover:brightness-110"
          >
            Começar agora
          </Link>
        </div>

        <ul className="mt-20 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="space-y-2">
              <Icon className="h-5 w-5 text-brand" />
              <p className="font-semibold">{title}</p>
              <p className="text-sm text-zinc-400">{text}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
