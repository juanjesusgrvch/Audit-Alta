"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "@/app/components/auth-provider";

type LoginPanelProps = {
  title: string;
  description: string;
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
    <main className="min-h-screen bg-[var(--background)] px-5 py-8 text-[var(--text)]">
      <section className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <article className="aether-panel rounded-lg p-8">
          <p className="font-display text-sm font-bold text-[var(--primary)]">
            ATL-CONSOLE
          </p>
          <h1 className="font-display mt-4 max-w-4xl text-5xl font-bold text-[var(--text)]">
            {title}
          </h1>
          <p className="mt-5 max-w-3xl text-sm leading-6 text-[var(--text-soft)]">
            {description}
          </p>
          <div className="mt-8 grid gap-3 text-sm text-[var(--text-muted)]">
            <p>Acceso con Firebase Auth del proyecto compartido.</p>
            <p>Las operaciones nuevas van a registrar tu UID en createdBy y updatedBy.</p>
            <p>Si una lectura server-side falla por Admin SDK, el login sigue siendo obligatorio pero no reemplaza la credencial del servidor.</p>
          </div>
        </article>

        <section className="aether-panel rounded-lg p-8">
          <h2 className="font-display text-2xl font-bold text-[var(--text)]">
            Iniciar sesion
          </h2>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Usa las mismas credenciales del proyecto anterior.
          </p>

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
              <div className="rounded-lg bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 ring-1 ring-red-100">
                {errorMessage}
              </div>
            ) : null}

            <button
              className="primary-action-button rounded-lg px-5 py-3 text-sm font-black text-[var(--primary-ink)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPending}
              type="submit"
            >
              {isPending ? "Ingresando..." : "Entrar al sistema"}
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}
