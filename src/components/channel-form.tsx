"use client";

import { useActionState, useState } from "react";
import { FOCUS_OPTIONS, MAX_FOCUS, MAX_INSTRUCTIONS, parseFocus } from "@/lib/focus";
import type { ChannelFormState } from "@/app/(app)/canais/actions";
import { SubmitButton } from "./submit-button";

const field =
  "w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm outline-none transition placeholder:text-zinc-600 focus:border-brand";

export interface ChannelDefaults {
  login?: string;
  layout?: string;
  duration?: string;
  language?: string;
  focus?: string;
  instructions?: string;
  sensitivity?: string;
  perHour?: string;
  minScore?: string;
}

export function ChannelForm({
  action,
  defaults = {},
  mode,
}: {
  action: (prev: ChannelFormState, form: FormData) => Promise<ChannelFormState>;
  defaults?: ChannelDefaults;
  mode: "add" | "edit";
}) {
  const [state, formAction] = useActionState<ChannelFormState, FormData>(action, {});
  const v = { ...defaults, ...(state.values ?? {}) } as ChannelDefaults;
  const [focus, setFocus] = useState<string[]>(parseFocus(v.focus));

  const toggle = (id: string) =>
    setFocus((cur) => (cur.includes(id) ? cur.filter((f) => f !== id) : cur.length < MAX_FOCUS ? [...cur, id] : cur));

  return (
    <form action={formAction} className="space-y-4">
      {mode === "add" ? (
        <input name="login" required defaultValue={v.login} placeholder="Canal da Twitch: gaules ou twitch.tv/gaules" className={field} />
      ) : (
        <input type="hidden" name="login" value={v.login} />
      )}

      <div>
        <p className="mb-2 text-sm text-zinc-400">O que cortar? (até {MAX_FOCUS}; nada marcado = qualquer momento forte)</p>
        <input type="hidden" name="focus" value={focus.join(",")} />
        <div className="flex flex-wrap gap-2">
          {FOCUS_OPTIONS.map((f) => {
            const on = focus.includes(f.id);
            return (
              <button
                type="button"
                key={f.id}
                title={f.hint}
                onClick={() => toggle(f.id)}
                disabled={!on && focus.length >= MAX_FOCUS}
                aria-pressed={on}
                className={`rounded-full border px-3 py-1.5 text-sm transition disabled:opacity-40 ${
                  on ? "border-brand bg-brand/10 text-zinc-100" : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="block space-y-1.5">
          <span className="text-xs text-zinc-500" title="A IA dá uma nota de 0 a 100 para cada corte; abaixo disso ele é descartado sem renderizar">
            Filtro de qualidade
          </span>
          <select name="minScore" defaultValue={v.minScore || "70"} className={field}>
            <option value="50">Solto (nota 50+)</option>
            <option value="60">Médio (nota 60+)</option>
            <option value="70">Exigente (nota 70+)</option>
            <option value="80">Só pérolas (nota 80+)</option>
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs text-zinc-500">Sensibilidade do chat</span>
          <select name="sensitivity" defaultValue={v.sensitivity || "2"} className={field}>
            <option value="1">Só os picos enormes</option>
            <option value="2">Equilibrado</option>
            <option value="3">Cortar mais</option>
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs text-zinc-500">Máx. cortes por hora</span>
          <select name="perHour" defaultValue={v.perHour || "8"} className={field}>
            {["4", "8", "12", "20"].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs text-zinc-500">Layout</span>
          <select name="layout" defaultValue={v.layout || "split"} className={field}>
            <option value="split">Webcam + gameplay</option>
            <option value="center">Tela cheia</option>
            <option value="blur">Fundo desfocado</option>
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs text-zinc-500">Duração</span>
          <select name="duration" defaultValue={v.duration || "medium"} className={field}>
            <option value="short">15 a 30s</option>
            <option value="medium">20 a 60s</option>
            <option value="long">45 a 90s</option>
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
        <input
          name="instructions"
          maxLength={MAX_INSTRUCTIONS}
          defaultValue={v.instructions}
          placeholder='Pedido extra (opcional): ex. "priorize momentos com o fulano na call"'
          className={field}
        />
        <select name="language" defaultValue={v.language || "pt-BR"} className={field}>
          <option value="pt-BR">Português</option>
          <option value="en">English</option>
          <option value="es">Español</option>
        </select>
      </div>

      {state.error && (
        <p role="alert" className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300">
          {state.ok}
        </p>
      )}

      <div className="sm:w-56">
        <SubmitButton pendingText="Salvando...">{mode === "add" ? "Monitorar canal" : "Salvar"}</SubmitButton>
      </div>
    </form>
  );
}
