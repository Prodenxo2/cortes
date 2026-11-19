"use client";

import { useActionState, useState } from "react";
import { ChevronDown, Link2, Sparkles } from "lucide-react";
import { createProjectAction, type NewProjectState } from "@/app/(app)/actions";
import { FOCUS_OPTIONS, MAX_FOCUS, MAX_INSTRUCTIONS, parseFocus } from "@/lib/focus";
import { SubmitButton } from "./submit-button";

const field =
  "w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm outline-none transition placeholder:text-zinc-600 focus:border-brand";

const LAYOUTS = [
  { value: "split", title: "Webcam + gameplay", hint: "Câmera detectada automaticamente no topo" },
  { value: "center", title: "Tela cheia", hint: "Crop central 9:16" },
  { value: "blur", title: "Fundo desfocado", hint: "Vídeo 16:9 inteiro no meio" },
];

export function NewProjectForm() {
  const [state, action] = useActionState<NewProjectState, FormData>(createProjectAction, {});
  const v = state.values ?? {};
  const [layout, setLayout] = useState(v.layout || "split");
  const [advanced, setAdvanced] = useState(Boolean(v.section));
  const [focus, setFocus] = useState<string[]>(parseFocus(v.focus));

  const toggleFocus = (id: string) =>
    setFocus((cur) => (cur.includes(id) ? cur.filter((f) => f !== id) : cur.length < MAX_FOCUS ? [...cur, id] : cur));

  return (
    <form action={action} className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div>
        <h2 className="text-lg font-semibold">Novo corte</h2>
        <p className="text-sm text-zinc-400">Cole o link de uma live que já terminou (YouTube ou VOD da Twitch).</p>
      </div>

      <div className="relative">
        <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <input
          name="url"
          required
          defaultValue={v.url}
          placeholder="https://www.youtube.com/watch?v=..."
          className={`${field} pl-9`}
        />
      </div>

      <fieldset>
        <legend className="mb-1 flex items-center gap-1.5 text-sm text-zinc-300">
          <Sparkles className="h-4 w-4 text-brand" />O que a IA deve procurar?
        </legend>
        <p className="mb-2 text-xs text-zinc-500">
          Escolha até {MAX_FOCUS}. Sem nada marcado, a IA pega os melhores momentos no geral.
        </p>
        <input type="hidden" name="focus" value={focus.join(",")} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setFocus([])}
            aria-pressed={focus.length === 0}
            className={`rounded-full border px-3 py-1.5 text-sm transition ${
              focus.length === 0 ? "border-brand bg-brand/10 text-zinc-100" : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
            }`}
          >
            Automático
          </button>
          {FOCUS_OPTIONS.map((f) => {
            const on = focus.includes(f.id);
            const disabled = !on && focus.length >= MAX_FOCUS;
            return (
              <button
                type="button"
                key={f.id}
                title={f.hint}
                onClick={() => toggleFocus(f.id)}
                disabled={disabled}
                aria-pressed={on}
                className={`rounded-full border px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  on ? "border-brand bg-brand/10 text-zinc-100" : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <textarea
          name="instructions"
          rows={2}
          maxLength={MAX_INSTRUCTIONS}
          defaultValue={v.instructions}
          placeholder='Pedido extra (opcional): ex. "a parte da perseguição de helicóptero" ou "quando ele zoa o amigo na call"'
          className={`${field} mt-3 resize-none`}
        />
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm text-zinc-400">Layout</legend>
        <input type="hidden" name="layout" value={layout} />
        <div className="grid gap-2 sm:grid-cols-3">
          {LAYOUTS.map((l) => (
            <button
              type="button"
              key={l.value}
              onClick={() => setLayout(l.value)}
              aria-pressed={layout === l.value}
              className={`rounded-lg border p-3 text-left transition ${
                layout === l.value ? "border-brand bg-brand/10" : "border-zinc-800 hover:border-zinc-600"
              }`}
            >
              <span className="block text-sm font-medium">{l.title}</span>
              <span className="block text-xs text-zinc-500">{l.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block space-y-1.5">
          <span className="text-sm text-zinc-400">Duração dos cortes</span>
          <select name="duration" defaultValue={v.duration || "medium"} className={field}>
            <option value="short">15 a 30s</option>
            <option value="medium">30 a 60s</option>
            <option value="long">60 a 90s</option>
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm text-zinc-400">Quantidade</span>
          <select name="clips" defaultValue={v.clips || "5"} className={field}>
            {[1, 3, 5, 8, 10].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "corte" : "cortes"}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm text-zinc-400">Idioma dos títulos</span>
          <select name="language" defaultValue={v.language || "pt-BR"} className={field}>
            <option value="pt-BR">Português</option>
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </label>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setAdvanced((a) => !a)}
          className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
        >
          <ChevronDown className={`h-4 w-4 transition ${advanced ? "rotate-180" : ""}`} />
          Só um trecho da live
        </button>
        {advanced && (
          <label className="mt-2 block space-y-1.5">
            <span className="text-xs text-zinc-500">
              Processa só esse intervalo (mais rápido em lives longas). Vazio = vídeo inteiro.
            </span>
            <input name="section" defaultValue={v.section} placeholder="1:00:00-1:30:00" className={field} />
          </label>
        )}
      </div>

      {state.error && (
        <p role="alert" className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {state.error}
        </p>
      )}

      <div className="sm:w-56">
        <SubmitButton pendingText="Enviando...">Gerar cortes</SubmitButton>
      </div>
    </form>
  );
}
