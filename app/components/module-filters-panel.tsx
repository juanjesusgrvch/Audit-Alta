"use client";

import type { MouseEvent, ReactNode } from "react";

export function ModuleFiltersPanel({
  children,
  isOpen,
  onClear,
  onToggle,
  subtitle = "Filtrar según:",
  title = "Filtros y Segmentación",
}: {
  children: ReactNode;
  isOpen: boolean;
  onClear: () => void;
  onToggle: () => void;
  subtitle?: string;
  title?: string;
}) {
  function handleHeaderClick(event: MouseEvent<HTMLDivElement>) {
    if (isOpen) {
      return;
    }

    if (event.target instanceof HTMLElement && event.target.closest("button")) {
      return;
    }

    onToggle();
  }

  return (
    <section className="aether-panel rounded-2xl px-4 py-4 md:px-5">
      <div
        className={`flex flex-col gap-3 md:flex-row md:items-center md:justify-between ${
          isOpen ? "" : "cursor-pointer"
        }`}
        onClick={handleHeaderClick}
      >
        <div>
          <p className="font-display text-base font-bold text-[var(--text)]">
            {title}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="console-secondary-button rounded-xl px-4 py-2.5 text-xs font-bold"
            onClick={onToggle}
            type="button"
          >
            {isOpen ? "Ocultar filtros" : "Mostrar filtros"}
          </button>
          <button
            className="rounded-xl bg-[var(--surface-high)] px-4 py-2.5 text-xs font-bold text-[var(--text-soft)] ring-1 ring-[var(--line)] transition hover:text-[var(--primary)] hover:ring-[var(--line-strong)]"
            onClick={onClear}
            type="button"
          >
            Limpiar
          </button>
        </div>
      </div>

      {isOpen ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

export function ModuleFilterField({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="grid gap-1 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">
      {label}
      {children}
    </label>
  );
}
