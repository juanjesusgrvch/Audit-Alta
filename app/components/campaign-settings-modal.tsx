"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchWithFirebaseAuth } from "@/lib/client/auth-fetch";
import {
  refreshCampaignPeriods,
  useCampaignPeriods,
  type CampaignPeriod
} from "@/lib/client/campaign-periods";
import type { ActionState } from "@/types/schema";

type GuardarCampaniasData = {
  cantidad: number;
};

type CampaignDraft = CampaignPeriod;

function createDraft(): CampaignDraft {
  return {
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `campania-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    nombre: "",
    fechaDesde: "",
    fechaHasta: "",
    predeterminada: false
  };
}

export function CampaignSettingsModal({
  onClose
}: {
  onClose: () => void;
}) {
  const { campaigns, isLoading } = useCampaignPeriods();
  const [drafts, setDrafts] = useState<CampaignDraft[]>([]);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setDrafts(campaigns.length > 0 ? campaigns : [createDraft()]);
  }, [campaigns]);

  const canSave = useMemo(
    () =>
      drafts.every(
        (draft) =>
          draft.nombre.trim().length > 0 &&
          draft.fechaDesde.length > 0 &&
          draft.fechaHasta.length > 0 &&
          draft.fechaHasta >= draft.fechaDesde
      ),
    [drafts]
  );

  function updateDraft(
    draftId: string,
    field: keyof CampaignDraft,
    value: string | boolean
  ) {
    setDrafts((currentValue) =>
      currentValue.map((draft) =>
        field === "predeterminada"
          ? {
              ...draft,
              predeterminada:
                draft.id === draftId ? Boolean(value) : false
            }
          : draft.id === draftId
            ? { ...draft, [field]: value }
            : draft
      )
    );
  }

  async function handleSave() {
    setError(null);
    setSuccess(null);

    if (!canSave) {
      setError(
        "Complete nombre, fecha de inicio y fecha de cierre en cada campaña."
      );
      return;
    }

    setIsPending(true);

    try {
      const response = await fetchWithFirebaseAuth("/api/campanias", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          campanias: drafts
        })
      });
      const result = (await response.json()) as ActionState<GuardarCampaniasData>;

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setSuccess(result.message);
      await refreshCampaignPeriods();
      onClose();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "No fue posible guardar las campañas."
      );
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
      <section className="aether-panel w-full max-w-4xl rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-6 py-5">
          <div>
            <h2 className="font-display text-2xl font-bold text-[var(--text)]">
              Periodos de campaña
            </h2>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Defina el rango real de cada campaña para filtrar operaciones por
              temporada y no por año calendario.
            </p>
          </div>
          <button
            className="console-secondary-button rounded-xl px-4 py-2 text-xs font-bold"
            onClick={onClose}
            type="button"
          >
            Cerrar
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-6">
          {isLoading && drafts.length === 0 ? (
            <div className="rounded-xl bg-[var(--surface-low)] px-4 py-4 text-sm font-semibold text-[var(--text-muted)] ring-1 ring-[var(--line)]">
              Cargando campañas...
            </div>
          ) : null}

          <div className="grid gap-4">
            {drafts.map((draft, index) => (
              <article
                className="grid gap-3 rounded-xl bg-[var(--surface-low)] p-4 ring-1 ring-[var(--line)] md:grid-cols-[minmax(0,1.3fr)_minmax(170px,0.8fr)_minmax(170px,0.8fr)_minmax(160px,0.65fr)_auto]"
                key={draft.id}
              >
                <label className="grid gap-1 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  Nombre
                  <input
                    className="aether-field h-10 py-2 text-sm"
                    onChange={(event) =>
                      updateDraft(draft.id, "nombre", event.target.value)
                    }
                    placeholder={`Campaña ${index + 1}`}
                    value={draft.nombre}
                  />
                </label>
                <label className="grid gap-1 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  Desde
                  <input
                    className="aether-field h-10 py-2 text-sm"
                    onChange={(event) =>
                      updateDraft(draft.id, "fechaDesde", event.target.value)
                    }
                    type="date"
                    value={draft.fechaDesde}
                  />
                </label>
                <label className="grid gap-1 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  Hasta
                  <input
                    className="aether-field h-10 py-2 text-sm"
                    onChange={(event) =>
                      updateDraft(draft.id, "fechaHasta", event.target.value)
                    }
                    type="date"
                    value={draft.fechaHasta}
                  />
                </label>
                <label className="flex items-center gap-3 rounded-xl bg-[var(--surface)] px-4 py-3 text-xs font-bold text-[var(--text)] ring-1 ring-[var(--line)]">
                  <input
                    checked={draft.predeterminada}
                    onChange={(event) =>
                      updateDraft(
                        draft.id,
                        "predeterminada",
                        event.target.checked
                      )
                    }
                    type="checkbox"
                  />
                  Campaña predeterminada
                </label>
                <div className="flex items-end">
                  <button
                    className="console-danger-button rounded-xl px-4 py-2 text-xs font-bold"
                    onClick={() =>
                      setDrafts((currentValue) =>
                        currentValue.length > 1
                          ? currentValue.filter((item) => item.id !== draft.id)
                          : [createDraft()]
                      )
                    }
                    type="button"
                  >
                    Quitar
                  </button>
                </div>
              </article>
            ))}
          </div>

          <button
            className="console-secondary-button mt-4 rounded-xl px-4 py-2 text-xs font-bold"
            onClick={() => setDrafts((currentValue) => [...currentValue, createDraft()])}
            type="button"
          >
            Agregar campaña
          </button>

          {error ? (
            <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 ring-1 ring-red-100">
              {error}
            </div>
          ) : null}

          {success ? (
            <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-100">
              {success}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[var(--line)] px-6 py-5">
          <button
            className="console-secondary-button rounded-xl px-4 py-2 text-xs font-bold"
            onClick={onClose}
            type="button"
          >
            Cancelar
          </button>
          <button
            className="primary-action-button rounded-xl px-5 py-2 text-xs font-black text-[var(--primary-ink)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isPending}
            onClick={() => void handleSave()}
            type="button"
          >
            {isPending ? "Guardando..." : "Guardar campañas"}
          </button>
        </div>
      </section>
    </div>
  );
}
