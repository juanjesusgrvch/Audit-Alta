"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "@/app/components/auth-provider";

type LoginPanelProps = {
  title?: string;
  description?: string;
};

type LoginFormValues = {
  email: string;
  password: string;
};

export function LoginPanel({ title, description }: LoginPanelProps) {
  const { login } = useAuth();
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const form = useForm<LoginFormValues>({
    defaultValues: {
      email: "",
      password: ""
    }
  });

  const handleSubmit = form.handleSubmit(async (values) => {
    setErrorMessage(null);
    setIsPending(true);

    try {
      await login(values.email.trim(), values.password);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "No fue posible iniciar sesion."
      );
    } finally {
      setIsPending(false);
    }
  });

  return (
    <main className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,#f6fbff_0%,#fff8ef_52%,#f7fbf5_100%)] px-5 py-8 text-[var(--text)]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-20 top-12 h-64 w-64 rounded-full bg-sky-200/45 blur-3xl" />
        <div className="absolute right-[-4rem] top-24 h-72 w-72 rounded-full bg-amber-200/40 blur-3xl" />
        <div className="absolute bottom-[-5rem] left-1/3 h-80 w-80 rounded-full bg-emerald-200/35 blur-3xl" />
      </div>

      <section className="relative mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <article className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-white/78 p-8 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur-xl lg:p-10">
          <div className="absolute inset-x-0 top-0 h-1.5 bg-[linear-gradient(90deg,#38bdf8_0%,#f59e0b_52%,#34d399_100%)]" />
          <div className="inline-flex rounded-full border border-sky-100 bg-sky-50/90 px-4 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-sky-700">
            Stock Alta
          </div>

          <h1 className="font-display mt-6 max-w-4xl text-5xl font-bold leading-[0.96] text-slate-950 lg:text-6xl">
            {title ?? "La operacion diaria, en una sola vista clara"}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600">
            {description ??
              "Segui ingresos, cargas, procesos y envases con una experiencia ordenada, agil y pensada para el ritmo real de trabajo."}
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-sky-100 bg-sky-50/80 px-4 py-4">
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-sky-700">
                Flujo diario
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-800">
                Todo el movimiento operativo en una experiencia continua.
              </p>
            </div>
            <div className="rounded-2xl border border-amber-100 bg-amber-50/85 px-4 py-4">
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-amber-700">
                Trazabilidad
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-800">
                Clientes, procesos y envases conectados sin perder contexto.
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/85 px-4 py-4">
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-emerald-700">
                Ritmo simple
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-800">
                Una entrada limpia para empezar rapido y trabajar con foco.
              </p>
            </div>
          </div>
        </article>

        <section className="relative rounded-[2rem] border border-white/80 bg-white/88 p-8 shadow-[0_24px_70px_rgba(15,23,42,0.14)] backdrop-blur-xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[var(--primary)]">
                Bienvenida
              </p>
              <h2 className="font-display mt-3 text-3xl font-bold text-slate-950">
                Iniciar sesion
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Entra con tu cuenta para continuar.
              </p>
            </div>
            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
              Acceso
            </div>
          </div>

          <form className="mt-8 grid gap-5" onSubmit={handleSubmit}>
            <label className="grid gap-2 text-xs font-bold text-[var(--text-muted)]">
              Email
              <input
                autoComplete="email"
                className="aether-field"
                placeholder="usuario@empresa.com"
                type="email"
                {...form.register("email", { required: true })}
              />
            </label>

            <label className="grid gap-2 text-xs font-bold text-[var(--text-muted)]">
              Contrasena
              <input
                autoComplete="current-password"
                className="aether-field"
                placeholder="Tu contrasena"
                type="password"
                {...form.register("password", { required: true })}
              />
            </label>

            {errorMessage ? (
              <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 ring-1 ring-red-100">
                {errorMessage}
              </div>
            ) : null}

            <button
              className="rounded-2xl bg-[linear-gradient(135deg,#0ea5e9_0%,#0284c7_42%,#059669_100%)] px-5 py-3 text-sm font-black text-white shadow-[0_18px_34px_rgba(14,165,233,0.28)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPending}
              type="submit"
            >
              {isPending ? "Ingresando..." : "Entrar"}
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}
