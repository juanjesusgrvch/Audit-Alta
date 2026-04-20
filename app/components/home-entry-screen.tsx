"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoginPanel } from "@/app/components/login-panel";
import { useAuth } from "@/app/components/auth-provider";

export function HomeEntryScreen() {
  const router = useRouter();
  const { status } = useAuth();

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/modulos?tab=descargas");
    }
  }, [router, status]);

  if (status === "loading" || status === "authenticated") {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--background)] px-5 text-[var(--text)]">
        <div className="aether-panel rounded-lg px-6 py-5 text-sm font-semibold text-[var(--text-soft)]">
          Preparando consola...
        </div>
      </main>
    );
  }

  return (
    <LoginPanel
      description="Ingresa con tu cuenta para abrir la consola de modulos."
      title="Stock-Alta"
    />
  );
}
