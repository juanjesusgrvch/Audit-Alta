"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/app/components/auth-provider";
import { LoginPanel } from "@/app/components/login-panel";

export function AuthGuard({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--background)] px-5 text-[var(--text)]">
        <div className="aether-panel rounded-lg px-6 py-5 text-sm font-semibold text-[var(--text-soft)]">
          Validando sesion...
        </div>
      </main>
    );
  }

  if (status === "unauthenticated") {
    return (
      <LoginPanel
        description="La consola unificada de modulos necesita una sesion valida antes de leer o escribir en Firebase."
        title="Acceso a modulos"
      />
    );
  }

  return children;
}
