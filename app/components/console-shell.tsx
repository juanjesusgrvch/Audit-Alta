"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useAuth } from "@/app/components/auth-provider";
import { CampaignSettingsModal } from "@/app/components/campaign-settings-modal";
import { useTheme } from "@/app/components/theme-provider";
import { preloadModuleData } from "@/lib/client/module-data";

type ConsoleModuleKey = "descargas" | "cargas" | "envases" | "procesos";

type ConsoleShellProps = {
  active: ConsoleModuleKey;
  children: ReactNode;
  firestoreDisponible: boolean;
  footerHint: string;
  footerLabel: string;
};

const navItems: Array<{ href: string; key: ConsoleModuleKey; label: string }> =
  [
    { href: "/modulos?tab=descargas", key: "descargas", label: "Descargas" },
    { href: "/modulos?tab=cargas", key: "cargas", label: "Cargas" },
    { href: "/modulos?tab=envases", key: "envases", label: "Envases" },
    { href: "/modulos?tab=procesos", key: "procesos", label: "Procesos" },
  ];

function MenuIcon() {
  return (
    <span aria-hidden className="flex h-4 w-5 flex-col justify-between">
      <span className="block h-0.5 w-full rounded-full bg-current" />
      <span className="block h-0.5 w-full rounded-full bg-current" />
      <span className="block h-0.5 w-full rounded-full bg-current" />
    </span>
  );
}

export function ConsoleShell({
  active,
  children,
  firestoreDisponible,
  footerHint,
  footerLabel,
}: ConsoleShellProps) {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const { logout, user } = useAuth();
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCampaignsModalOpen, setIsCampaignsModalOpen] = useState(false);
  const optionsRef = useRef<HTMLDivElement | null>(null);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    for (const item of navItems) {
      router.prefetch(item.href);
    }
  }, [router]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;

      if (optionsRef.current && !optionsRef.current.contains(target)) {
        setIsOptionsOpen(false);
      }

      if (mobileMenuRef.current && !mobileMenuRef.current.contains(target)) {
        setIsMobileMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOptionsOpen(false);
        setIsMobileMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const currentThemeLabel = theme === "dark" ? "Oscuro" : "Claro";
  const nextThemeLabel =
    theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro";
  const processGuideHref = "/images/guia_procesos.jpg";

  const mobileMenu = isMobileMenuOpen ? (
    <div className="fixed inset-0 z-40 bg-slate-950/36 backdrop-blur-[2px] lg:hidden">
      <div className="h-full max-w-sm px-4 pb-4 pt-20" ref={mobileMenuRef}>
        <section className="aether-panel grid gap-5 rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-display text-lg font-bold text-[var(--text)]">
                Menu
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Accesos rapidos de la consola
              </p>
            </div>
            <button
              className="rounded-lg px-3 py-2 text-sm font-bold text-[var(--text-muted)] hover:bg-[var(--surface-high)] hover:text-[var(--text)]"
              onClick={() => setIsMobileMenuOpen(false)}
              type="button"
            >
              Cerrar
            </button>
          </div>

          <div className="grid gap-3">
            <div>
              <p className="px-1 text-[11px] font-black uppercase tracking-[0.24em] text-[var(--text-muted)]">
                Modulos
              </p>
              <nav className="mt-3 grid gap-2">
                {navItems.map((item) => {
                  const isActive = item.key === active;

                  return (
                    <Link
                      className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm font-semibold transition ${
                        isActive
                          ? "bg-[var(--nav-active-bg)] text-[var(--primary)] ring-1 ring-[var(--line-strong)]"
                          : "bg-[var(--surface-low)] text-[var(--text-soft)] ring-1 ring-[var(--line)] hover:text-[var(--text)]"
                      }`}
                      href={item.href}
                      key={item.href}
                      onClick={() => setIsMobileMenuOpen(false)}
                      onMouseEnter={() => {
                        router.prefetch(item.href);
                        preloadModuleData(item.key);
                      }}
                      prefetch
                    >
                      <span>{item.label}</span>
                      {isActive ? (
                        <span className="h-2 w-2 rounded-full bg-[var(--primary)]" />
                      ) : null}
                    </Link>
                  );
                })}
              </nav>
            </div>

            <div>
              <p className="px-1 text-[11px] font-black uppercase tracking-[0.24em] text-[var(--text-muted)]">
                Cuenta
              </p>
              <div className="mt-3 grid gap-2">
                <div className="rounded-xl bg-[var(--surface-low)] px-4 py-3 text-sm ring-1 ring-[var(--line)]">
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">
                    Usuario
                  </p>
                  <p className="mt-2 break-all font-semibold text-[var(--text)]">
                    {user?.email ?? user?.uid ?? "Sesion activa"}
                  </p>
                </div>
                <button
                  className="flex items-center justify-between rounded-xl bg-[var(--surface-low)] px-4 py-3 text-left text-sm font-semibold text-[var(--text)] ring-1 ring-[var(--line)]"
                  onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                    event.preventDefault();
                    toggleTheme();
                  }}
                  type="button"
                >
                  <span>{nextThemeLabel}</span>
                  <span className="text-xs font-bold text-[var(--text-muted)]">
                    {currentThemeLabel}
                  </span>
                </button>
                <button
                  className="flex items-center justify-between rounded-xl bg-[var(--surface-low)] px-4 py-3 text-left text-sm font-semibold text-[var(--text)] ring-1 ring-[var(--line)]"
                  onClick={() => {
                    setIsCampaignsModalOpen(true);
                    setIsMobileMenuOpen(false);
                  }}
                  type="button"
                >
                  <span>Campañas</span>
                  <span className="text-xs font-bold text-[var(--text-muted)]">
                    Editar
                  </span>
                </button>
                <a
                  className="flex items-center justify-between rounded-xl bg-[var(--surface-low)] px-4 py-3 text-left text-sm font-semibold text-[var(--text)] ring-1 ring-[var(--line)]"
                  download
                  href={processGuideHref}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <span>Descargar guia de procesos</span>
                  <span className="text-xs font-bold text-[var(--text-muted)]">
                    JPG
                  </span>
                </a>
                <div className="console-status-chip flex items-center justify-between rounded-xl px-4 py-3 text-sm font-semibold">
                  <span>Conectado</span>
                  <span>{firestoreDisponible ? "Activo" : "Pendiente"}</span>
                </div>
                <button
                  className="console-danger-button rounded-xl bg-[var(--surface-low)] px-4 py-3 text-left text-sm font-semibold ring-1 ring-[var(--line)]"
                  onClick={() => {
                    void logout().then(() => {
                      router.replace("/");
                    });
                  }}
                  type="button"
                >
                  Salir
                </button>
              </div>
            </div>

          </div>
        </section>
      </div>
    </div>
  ) : null;

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--text)]">
      {mobileMenu}
      {isCampaignsModalOpen ? (
        <CampaignSettingsModal
          onClose={() => {
            setIsCampaignsModalOpen(false);
            setIsOptionsOpen(false);
          }}
        />
      ) : null}

      <header className="console-header sticky top-0 z-30 border-b border-[var(--line)] backdrop-blur-xl">
        <div className="flex min-h-16 items-center justify-between gap-4 px-4 md:px-6 lg:px-8">
          <div className="flex items-center gap-3 md:gap-6">
            <button
              aria-expanded={isMobileMenuOpen}
              className="console-ghost-button inline-flex h-10 w-10 items-center justify-center rounded-xl text-[var(--text-soft)] lg:hidden"
              onClick={() =>
                setIsMobileMenuOpen((currentValue) => !currentValue)
              }
              type="button"
            >
              <span className="sr-only">Abrir menu</span>
              <MenuIcon />
            </button>

            <Link
              className="font-display text-base font-bold tracking-[0.18em] text-[var(--primary)] md:text-lg"
              href="/modulos?tab=descargas"
              prefetch
            >
              STOCK-ALTA SA
            </Link>

            <div className="hidden items-center gap-2 lg:flex">
              {navItems.map((item) => (
                <Link
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    item.key === active
                      ? "bg-[var(--nav-active-bg)] text-[var(--primary)] ring-1 ring-[var(--line-strong)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--nav-hover-bg)] hover:text-[var(--text)]"
                  }`}
                  href={item.href}
                  key={item.href}
                  onMouseEnter={() => {
                    router.prefetch(item.href);
                    preloadModuleData(item.key);
                  }}
                  prefetch
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs font-bold md:gap-3">
            <span className="hidden rounded-xl bg-[var(--surface-high)] px-3 py-2 text-xs font-bold text-[var(--text-soft)] ring-1 ring-[var(--line)] xl:inline-flex">
              {user?.email ?? user?.uid ?? "Sesion activa"}
            </span>
            <span className="console-status-chip hidden items-center gap-2 rounded-xl px-3 py-2 sm:inline-flex">
              <span className="h-2 w-2 rounded-full bg-[var(--tertiary)]" />
              {firestoreDisponible ? "Conectado" : "Pendiente"}
            </span>

            <div className="relative hidden sm:block" ref={optionsRef}>
              <button
                aria-expanded={isOptionsOpen}
                className="console-ghost-button rounded-xl px-3 py-2 text-[var(--text-muted)]"
                onClick={() =>
                  setIsOptionsOpen((currentValue) => !currentValue)
                }
                type="button"
              >
                Opciones
              </button>

              {isOptionsOpen ? (
                <div className="options-menu absolute right-0 top-[calc(100%+0.5rem)] z-50 w-72 rounded-xl p-2">
                  <div className="px-3 py-2 text-[11px] font-bold uppercase text-[var(--text-muted)]">
                    Apariencia
                  </div>
                  <button
                    className="option-item flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm font-semibold text-[var(--text)]"
                    onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                      event.preventDefault();
                      toggleTheme();
                    }}
                    type="button"
                  >
                    <span>{nextThemeLabel}</span>
                    <span className="text-xs font-bold text-[var(--text-muted)]">
                      {currentThemeLabel}
                    </span>
                  </button>
                  <button
                    className="option-item mt-2 flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm font-semibold text-[var(--text)]"
                    onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                      event.preventDefault();
                      setIsCampaignsModalOpen(true);
                      setIsOptionsOpen(false);
                    }}
                    type="button"
                  >
                    <span>Periodos de campaña</span>
                    <span className="text-xs font-bold text-[var(--text-muted)]">
                      Editar
                    </span>
                  </button>
                  <a
                    className="option-item mt-2 flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm font-semibold text-[var(--text)]"
                    download
                    href={processGuideHref}
                  >
                    <span>Descargar guia de procesos</span>
                    <span className="text-xs font-bold text-[var(--text-muted)]">
                      JPG
                    </span>
                  </a>
                  <div className="mt-2 rounded-xl bg-[var(--surface-high)] px-3 py-3 text-xs font-semibold text-[var(--text-muted)]">
                    El tema se guarda en este navegador y las campañas quedan
                    disponibles en toda la consola.
                  </div>
                </div>
              ) : null}
            </div>

            <button
              className="console-danger-button hidden rounded-xl px-3 py-2 sm:inline-flex"
              onClick={() => {
                void logout().then(() => {
                  router.replace("/");
                });
              }}
              type="button"
            >
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className="grid gap-8 px-4 py-6 md:px-6 lg:px-8 lg:py-8">
        {children}
      </main>
    </div>
  );
}
