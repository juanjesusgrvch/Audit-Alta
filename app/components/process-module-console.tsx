"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { ConsoleShell } from "@/app/components/console-shell";
import {
  EyeIcon,
  PencilIcon,
  RefreshIcon,
  TrashIcon,
} from "@/app/components/console-icons";
import { ModuleFilterField } from "@/app/components/module-filters-panel";
import { ModuleIntegratedFilters } from "@/app/components/module-integrated-filters";
import { ModuleLoadingIndicator } from "@/app/components/module-loading-indicator";
import { ModuleSearchBox } from "@/app/components/module-search-box";
import { PaginationControls } from "@/app/components/pagination-controls";
import { AutoFitMetricValue } from "@/app/components/auto-fit-metric-value";
import { fetchWithFirebaseAuth } from "@/lib/client/auth-fetch";
import {
  getDefaultCampaignId,
  mergeCampaignDateRange,
  resolveCampaignPeriod,
  useCampaignPeriods,
} from "@/lib/client/campaign-periods";
import { refreshAllModuleData } from "@/lib/client/module-data";
import { buildStoredProcessLots } from "@/lib/shared/stored-process-lots";
import { syncRelationalAutoFilledFields } from "@/lib/client/relational-autofill";
import type {
  EnvaseOption,
  RegistroOperacion,
} from "@/lib/services/operaciones";
import type {
  ProcesoMutationData,
  ProcesoStoredItem,
  RegistroProceso,
} from "@/lib/services/procesos";
import { compactarEspacios, construirEnvaseInventoryId } from "@/lib/utils";
import {
  procesoRegistroFormSchema,
  type ActionState,
  type GradoSalidaProceso,
  type ProcesoRegistroFormInput,
  type TipoOrdenProceso,
} from "@/types/schema";

type ProcessModuleConsoleProps = {
  registros: RegistroProceso[];
  ingresosRelacionados: RegistroOperacion[];
  envases: EnvaseOption[];
  firestoreDisponible: boolean;
  isLoading?: boolean;
  loadError?: string | null;
};

type ProcessFilters = {
  cliente: string;
  envase: string;
  from: string;
  grado: string;
  procedencia: string;
  producto: string;
  proceso: string;
  query: string;
  to: string;
};

type RelationalFieldKey = "cliente" | "procedencia" | "producto" | "proceso";

type ProcesoFormSeed = {
  values: ProcesoRegistroFormInput;
};

type PlantStockOption = {
  inventoryId: string;
  visibleId: string;
  envaseTipoId: string;
  envaseTipoNombre: string;
  envaseEstado: string;
  kilos: number;
  cantidad: number;
};

const REGISTROS_POR_PAGINA = 8;
const RELATIONAL_FIELDS: RelationalFieldKey[] = [
  "cliente",
  "proceso",
  "procedencia",
  "producto",
];
const DETALLE_SUGGESTIONS = ["Materia Extraña", "Procesado", "Rechazo"];
const GRADO_LABELS: Record<GradoSalidaProceso, string> = {
  exportacion: "Exportacion",
  recupero: "Recupero",
  no_recuperable: "No recuperable",
};
const TIPO_ORDEN_LABELS: Record<TipoOrdenProceso, string> = {
  procesado: "Procesado",
  reprocesado: "Reprocesado",
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function uniqueValues(values: Array<string | null | undefined>) {
  return [
    ...new Set(values.map((value) => (value ?? "").trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "es"));
}

function formatNumber(value: number, digits = 2) {
  return new Intl.NumberFormat("es-AR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatKilos(value: number) {
  return `${formatNumber(value, 0)} kg`;
}

function formatToneladasFromKg(value: number) {
  return `${formatNumber(value / 1000, 2)} TN`;
}

function formatDateKey(value: Date | null) {
  if (!value) {
    return "";
  }

  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(value: Date | null) {
  if (!value) {
    return "Sin fecha";
  }

  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
}

function getTodayLocalInputValue() {
  return formatDateKey(new Date());
}

function compareRecordsDesc(a: RegistroProceso, b: RegistroProceso) {
  const aValue = a.fechaProceso?.getTime() ?? a.createdAt?.getTime() ?? 0;
  const bValue = b.fechaProceso?.getTime() ?? b.createdAt?.getTime() ?? 0;
  return bValue - aValue;
}

function buildProcessFormSeed(
  record: RegistroProceso | null,
  todayValue: string,
): ProcesoFormSeed {
  if (!record) {
    return {
      values: {
        fechaProceso: todayValue,
        cliente: "",
        proceso: "",
        procedencia: "",
        producto: "",
        tipoOrden: "procesado",
        salidas: [
          {
            grado: "exportacion",
            detalle: "Procesado",
            kilos: 0,
            cantidadEnvases: 0,
            envaseTipoId: "",
            inventoryId: "",
            envaseEstado: "",
            envaseKilos: 0,
            envaseVisibleId: "",
          },
        ],
        observaciones: "",
      },
    };
  }

  return {
    values: {
      fechaProceso: formatDateKey(record.fechaProceso) || todayValue,
      cliente: record.cliente,
      proceso: record.proceso,
      procedencia: record.procedencia || record.proveedor || "",
      producto: record.producto || "",
      tipoOrden: record.tipoOrden,
      salidas:
        record.salidas.length > 0
          ? record.salidas.map((salida) => ({
              id: salida.id,
              grado: salida.grado,
              detalle: salida.detalle,
              kilos: salida.kilos,
              cantidadEnvases: salida.cantidadEnvases ?? 0,
              envaseTipoId: salida.envaseTipoId || "",
              inventoryId:
                salida.inventoryId ||
                (salida.envaseTipoId && salida.envaseEstado
                  ? construirEnvaseInventoryId(
                      salida.envaseTipoId,
                      salida.envaseEstado,
                      Number(salida.envaseKilos ?? 0),
                    )
                  : ""),
              envaseEstado: salida.envaseEstado || "",
              envaseKilos: Number(salida.envaseKilos ?? 0),
              envaseVisibleId:
                salida.envaseVisibleId ||
                (salida.envaseTipoNombre && salida.envaseEstado
                  ? `${salida.envaseTipoNombre} | ${salida.envaseEstado} | ${Number(
                      salida.envaseKilos ?? 0,
                    )} kg`
                  : ""),
            }))
          : [
              {
                grado: "exportacion",
                detalle: "Procesado",
                kilos: 0,
                cantidadEnvases: 0,
                envaseTipoId: "",
                inventoryId: "",
                envaseEstado: "",
                envaseKilos: 0,
                envaseVisibleId: "",
              },
            ],
      observaciones: record.observaciones ?? "",
    },
  };
}

function getRelationFieldValue(
  record: RegistroOperacion,
  field: RelationalFieldKey,
) {
  if (field === "cliente") {
    return record.cliente;
  }

  if (field === "proceso") {
    return record.proceso;
  }

  if (field === "procedencia") {
    return (record.procedencia || record.proveedor || "").trim();
  }

  return (record.producto ?? "").trim();
}

function matchesRelationalFieldSet(
  record: RegistroOperacion,
  values: Record<RelationalFieldKey, string>,
  ignoredField?: RelationalFieldKey,
) {
  return RELATIONAL_FIELDS.every((field) => {
    if (field === ignoredField) {
      return true;
    }

    const currentValue = values[field].trim();

    if (!currentValue) {
      return true;
    }

    return normalize(getRelationFieldValue(record, field)).includes(
      normalize(currentValue),
    );
  });
}

function matchesDateRange(dateKey: string, from: string, to: string) {
  if (!dateKey) {
    return false;
  }

  if (from && dateKey < from) {
    return false;
  }

  if (to && dateKey > to) {
    return false;
  }

  return true;
}

function getProcesoEnvaseLabel(
  record: RegistroProceso,
  salida: RegistroProceso["salidas"][number],
) {
  const envaseNombre = compactarEspacios(
    salida.envaseVisibleId ||
      salida.envaseTipoNombre ||
      salida.envaseTipoId ||
      "",
  );

  if (!envaseNombre) {
    return "";
  }

  const kilosEnvase = Number(salida.envaseKilos ?? 0);
  const cantidadEnvases = Number(salida.cantidadEnvases ?? 0);
  return `${envaseNombre} | ${formatNumber(kilosEnvase, 0)} kg | ${formatNumber(cantidadEnvases, 0)} env.`;
}

function matchesProcessFilters(
  record: RegistroProceso,
  filters: ProcessFilters,
  ignoredField?: keyof ProcessFilters,
) {
  const dateKey = formatDateKey(record.fechaProceso);

  if (!matchesDateRange(dateKey, filters.from, filters.to)) {
    return false;
  }

  if (
    ignoredField !== "cliente" &&
    filters.cliente !== "todos" &&
    record.cliente !== filters.cliente
  ) {
    return false;
  }

  if (
    ignoredField !== "proceso" &&
    filters.proceso !== "todos" &&
    record.proceso !== filters.proceso
  ) {
    return false;
  }

  if (
    ignoredField !== "procedencia" &&
    filters.procedencia !== "todos" &&
    (record.procedencia || record.proveedor || "") !== filters.procedencia
  ) {
    return false;
  }

  if (
    ignoredField !== "producto" &&
    filters.producto !== "todos" &&
    (record.producto || "Sin producto") !== filters.producto
  ) {
    return false;
  }

  if (
    ignoredField !== "grado" &&
    filters.grado !== "todos" &&
    !record.salidas.some(
      (salida) => GRADO_LABELS[salida.grado] === filters.grado,
    )
  ) {
    return false;
  }

  if (
    ignoredField !== "envase" &&
    filters.envase !== "todos" &&
    !record.salidas.some(
      (salida) => getProcesoEnvaseLabel(record, salida) === filters.envase,
    )
  ) {
    return false;
  }

  const normalizedQuery = normalize(filters.query);

  if (!normalizedQuery || ignoredField === "query") {
    return true;
  }

  return [
    record.cliente,
    record.proceso,
    record.procedencia || record.proveedor,
    record.producto,
    record.tipoOrden,
    ...record.salidas.flatMap((salida) => [
      salida.detalle,
      GRADO_LABELS[salida.grado],
      getProcesoEnvaseLabel(record, salida),
    ]),
  ]
    .filter(Boolean)
    .some((value) => normalize(String(value)).includes(normalizedQuery));
}

function buildStoredItems(
  records: RegistroProceso[],
  cargas: RegistroOperacion[],
): ProcesoStoredItem[] {
  return buildStoredProcessLots(
    records,
    cargas.map((record) => ({
      id: record.id,
      envaseMode: record.envaseMode ?? "granel",
      loteEnvasadoDetalles: record.loteEnvasadoDetalles ?? [],
    })),
  ).map((lot) => ({
    id: lot.id,
    procesoId: lot.procesoId,
    salidaId: lot.salidaId,
    fechaProceso: lot.fechaProceso,
    cliente: lot.cliente,
    proceso: lot.proceso,
    producto: lot.producto,
    procedencia: lot.procedencia,
    grado: lot.grado,
    detalle: lot.detalle,
    kilos: lot.kilosTotal,
    kilosDisponibles: lot.kilosDisponibles,
    envaseTipoId: lot.envaseTipoId,
    envaseTipoNombre: lot.envaseTipoNombre,
    envaseEstado: lot.envaseEstado,
    envaseVisibleId: lot.envaseVisibleId,
    inventoryId: lot.inventoryId,
    pesoEnvaseKg: lot.pesoEnvaseKg,
    cantidadDisponible: lot.cantidadDisponible,
    tipoOrden: lot.tipoOrden,
  }));
}

function IconOnlyButton({
  active = false,
  children,
  danger = false,
  disabled = false,
  onClick,
  title,
}: {
  active?: boolean;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ring-1 transition ${
        danger
          ? "bg-red-50 text-red-600 ring-red-100 hover:bg-red-100"
          : active
            ? "bg-[var(--nav-active-bg)] text-[var(--primary)] ring-[var(--line-strong)]"
            : "bg-[var(--surface-low)] text-[var(--text-soft)] ring-[var(--line)] hover:text-[var(--text)]"
      } disabled:cursor-not-allowed disabled:opacity-45`}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}

function ReprocessIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M3 12a9 9 0 0 0 15.3 6.3" />
      <path d="M21 12A9 9 0 0 0 5.7 5.7" />
      <path d="M3 4v6h6" />
      <path d="M21 20v-6h-6" />
    </svg>
  );
}

function MetricCard({
  helper,
  label,
  value,
}: {
  helper: string;
  label: string;
  value: string;
}) {
  return (
    <article className="aether-panel flex min-h-32 flex-col justify-center rounded-2xl px-4 py-5 text-center">
      <p className="font-display text-[11px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)]">
        {label}
      </p>
      <AutoFitMetricValue
        className="w-full whitespace-nowrap font-display font-bold leading-none text-[var(--primary)]"
        maxSizeRem={2.8}
        minSizeRem={0.9}
        value={value}
      />
      <p className="mt-2 text-xs font-semibold text-[var(--text-soft)]">
        {helper}
      </p>
    </article>
  );
}

function SalidaDetailItem({
  align = "left",
  emphasis = false,
  label,
  value,
}: {
  align?: "left" | "center" | "right";
  emphasis?: boolean;
  label: string;
  value: string;
}) {
  const alignClass =
    align === "center"
      ? "text-left xl:text-center"
      : align === "right"
        ? "text-left xl:text-right"
        : "text-left";

  return (
    <div
      className={`grid gap-1 rounded-lg bg-white/70 px-3 py-2 ring-1 ring-[var(--line)]/70 ${alignClass}`}
    >
      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">
        {label}
      </span>
      <span
        className={`break-words text-sm ${emphasis ? "font-semibold text-[var(--text)]" : "text-[var(--text-soft)]"}`}
      >
        {value}
      </span>
    </div>
  );
}

function FilterSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <ModuleFilterField label={label}>
      <select
        className="aether-field h-10 py-2 text-sm"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="todos">Todos</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </ModuleFilterField>
  );
}

function HistorialCard({
  expanded,
  isPending,
  onDelete,
  onEdit,
  onToggle,
  record,
}: {
  expanded: boolean;
  isPending: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onToggle: () => void;
  record: RegistroProceso;
}) {
  return (
    <article className="aether-panel-soft rounded-2xl px-4 py-4 md:px-5">
      <div className="flex gap-4">
        <button
          className="flex-1 rounded-2xl text-left transition hover:bg-[var(--surface-high)]/28"
          onClick={onToggle}
          type="button"
        >
          <div className="grid gap-3 pr-2 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_140px_120px] md:items-center">
            <p className="truncate font-display text-base font-bold text-[var(--text)]">
              {record.proceso}
            </p>
            <p className="truncate text-sm font-semibold text-[var(--text-soft)]">
              {record.cliente} - {TIPO_ORDEN_LABELS[record.tipoOrden]}
            </p>
            <p className="text-sm font-semibold text-[var(--text-muted)] md:text-center">
              {formatDisplayDate(record.fechaProceso)}
            </p>
            <p className="font-display text-lg font-bold text-[var(--primary)] md:text-right">
              {formatKilos(record.kilosTotal)}
            </p>
          </div>
        </button>

        <div className="flex shrink-0 items-start gap-1">
          <IconOnlyButton
            active={expanded}
            onClick={onToggle}
            title="Ver detalle"
          >
            <EyeIcon className="h-4 w-4" />
          </IconOnlyButton>
          <IconOnlyButton
            disabled={isPending}
            onClick={onEdit}
            title="Editar proceso"
          >
            <PencilIcon className="h-4 w-4" />
          </IconOnlyButton>
          <IconOnlyButton
            danger
            disabled={isPending}
            onClick={onDelete}
            title="Eliminar proceso"
          >
            <TrashIcon className="h-4 w-4" />
          </IconOnlyButton>
        </div>
      </div>

      {expanded ? (
        <div className="mt-4 grid gap-4 border-t border-[var(--line)] pt-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl bg-[var(--surface-low)] px-4 py-3 text-sm text-[var(--text-soft)] ring-1 ring-[var(--line)]">
              <p>
                <span className="font-bold text-[var(--text)]">Cliente:</span>{" "}
                {record.cliente}
              </p>
              <p className="mt-2">
                <span className="font-bold text-[var(--text)]">
                  Procedencia:
                </span>{" "}
                {record.procedencia || record.proveedor || "Sin procedencia"}
              </p>
              <p className="mt-2">
                <span className="font-bold text-[var(--text)]">Producto:</span>{" "}
                {record.producto || "Sin producto"}
              </p>
              <p className="mt-2">
                <span className="font-bold text-[var(--text)]">Natural:</span>{" "}
                {formatKilos(record.kilosTotal)}
              </p>
            </div>
            <div className="rounded-xl bg-[var(--surface-low)] px-4 py-3 ring-1 ring-[var(--line)]">
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[var(--text-muted)]">
                Salidas del proceso
              </p>
              <div className="mt-3 grid gap-2">
                {record.salidas.map((salida) => (
                  <div
                    className="rounded-xl bg-[var(--surface)]/70 px-3 py-3 ring-1 ring-[var(--line)]"
                    key={`${record.id}-${salida.id}`}
                  >
                    <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)_140px_minmax(220px,1fr)]">
                      <SalidaDetailItem
                        emphasis
                        label="Grado"
                        value={GRADO_LABELS[salida.grado]}
                      />
                      <SalidaDetailItem
                        label="Detalle"
                        value={salida.detalle}
                      />
                      <SalidaDetailItem
                        align="center"
                        emphasis
                        label="Kilos"
                        value={formatKilos(salida.kilos)}
                      />
                      <SalidaDetailItem
                        align="right"
                        label="Envases"
                        value={
                          salida.envaseTipoId
                            ? `${salida.envaseTipoNombre || "Sin envase"} · ${formatNumber(
                                Number(salida.envaseKilos ?? 0),
                                0,
                              )} kg · ${formatNumber(
                                Number(salida.cantidadEnvases ?? 0),
                                0,
                              )} env.`
                            : "Sin envase"
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="rounded-xl bg-[var(--surface-low)] px-4 py-3 text-sm text-[var(--text-soft)] ring-1 ring-[var(--line)]">
            <span className="font-bold text-[var(--text)]">Observaciones:</span>{" "}
            {record.observaciones ?? "Sin observaciones"}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function StoredItemCard({
  expanded,
  item,
  onDelete,
  onEdit,
  onReprocess,
  onToggle,
  pendingAction,
}: {
  expanded: boolean;
  item: ProcesoStoredItem;
  onDelete: () => void;
  onEdit: () => void;
  onReprocess: () => void;
  onToggle: () => void;
  pendingAction: boolean;
}) {
  return (
    <article className="aether-panel-soft rounded-2xl px-4 py-4">
      <div className="flex gap-4">
        <button
          className="flex-1 rounded-2xl text-left transition hover:bg-[var(--surface-high)]/28"
          onClick={onToggle}
          type="button"
        >
          <div className="grid gap-3 pr-2 md:grid-cols-[minmax(0,1.3fr)_130px_minmax(0,1.4fr)_100px] md:items-center">
            <p className="truncate font-display text-base font-bold text-[var(--text)]">
              {item.producto} - {item.procedencia}
            </p>
            <p className="font-semibold text-[var(--text-soft)] md:text-center">
              {formatKilos(item.kilosDisponibles)}
            </p>
            <p className="truncate text-sm font-semibold text-[var(--text-soft)]">
              {formatNumber(item.cantidadDisponible, 0)} env. ·{" "}
              {item.envaseTipoNombre} · {formatNumber(item.pesoEnvaseKg, 0)} kg
            </p>
            <span className="rounded-full bg-[var(--surface-low)] px-3 py-1.5 text-center text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-soft)] ring-1 ring-[var(--line)]">
              {GRADO_LABELS[item.grado]}
            </span>
          </div>
        </button>

        <div className="flex shrink-0 items-start gap-1">
          <IconOnlyButton
            active={expanded}
            onClick={onToggle}
            title="Ver detalle"
          >
            <EyeIcon className="h-4 w-4" />
          </IconOnlyButton>
        </div>
      </div>

      {expanded ? (
        <div className="mt-4 grid gap-4 border-t border-[var(--line)] pt-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl bg-[var(--surface-low)] px-4 py-3 text-sm text-[var(--text-soft)] ring-1 ring-[var(--line)]">
              <p>
                <span className="font-bold text-[var(--text)]">Cliente:</span>{" "}
                {item.cliente}
              </p>
              <p className="mt-2">
                <span className="font-bold text-[var(--text)]">Proceso:</span>{" "}
                {item.proceso}
              </p>
              <p className="mt-2">
                <span className="font-bold text-[var(--text)]">
                  Fecha de envasado:
                </span>{" "}
                {formatDisplayDate(item.fechaProceso)}
              </p>
            </div>
            <div className="rounded-xl bg-[var(--surface-low)] px-4 py-3 text-sm text-[var(--text-soft)] ring-1 ring-[var(--line)]">
              <p>
                <span className="font-bold text-[var(--text)]">Detalle:</span>{" "}
                {item.detalle}
              </p>
              <p className="mt-2">
                <span className="font-bold text-[var(--text)]">Envase:</span>{" "}
                {item.envaseTipoNombre} · {formatNumber(item.pesoEnvaseKg, 0)}{" "}
                kg
              </p>
              <p className="mt-2">
                <span className="font-bold text-[var(--text)]">
                  Cantidad disponible:
                </span>{" "}
                {formatNumber(item.cantidadDisponible, 0)} env.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <IconOnlyButton
              disabled={pendingAction}
              onClick={onEdit}
              title="Editar proceso"
            >
              <PencilIcon className="h-4 w-4" />
            </IconOnlyButton>
            <IconOnlyButton
              danger
              disabled={pendingAction}
              onClick={onDelete}
              title="Eliminar salida"
            >
              <TrashIcon className="h-4 w-4" />
            </IconOnlyButton>
            <button
              className="console-secondary-button inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-45"
              disabled={pendingAction}
              onClick={onReprocess}
              type="button"
            >
              <ReprocessIcon className="h-4 w-4" />
              Reprocesar
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function ProcessModuleConsole({
  registros,
  ingresosRelacionados,
  envases,
  firestoreDisponible,
  isLoading = false,
  loadError = null,
}: ProcessModuleConsoleProps) {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<RegistroProceso | null>(
    null,
  );
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);
  const [expandedStoredItemId, setExpandedStoredItemId] = useState<
    string | null
  >(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [storedCurrentPage, setStoredCurrentPage] = useState(1);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    null,
  );
  const [feedback, setFeedback] = useState<{
    tone: "error" | "success";
    message: string;
  } | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [cargaRecords, setCargaRecords] = useState<RegistroOperacion[]>([]);
  const { campaigns } = useCampaignPeriods();
  const defaultCampaignId = useMemo(
    () => getDefaultCampaignId(campaigns),
    [campaigns],
  );
  const resolvedSelectedCampaignId =
    selectedCampaignId ?? defaultCampaignId ?? "all";
  const [filters, setFilters] = useState<ProcessFilters>({
    cliente: "todos",
    envase: "todos",
    from: "",
    grado: "todos",
    procedencia: "todos",
    producto: "todos",
    proceso: "todos",
    query: "",
    to: "",
  });
  const selectedCampaign = useMemo(
    () => resolveCampaignPeriod(campaigns, resolvedSelectedCampaignId),
    [campaigns, resolvedSelectedCampaignId],
  );

  useEffect(() => {
    setSelectedCampaignId((currentValue) => {
      if (currentValue === null) {
        return defaultCampaignId ?? "all";
      }

      if (currentValue === "all") {
        return currentValue;
      }

      return campaigns.some((campaign) => campaign.id === currentValue)
        ? currentValue
        : (defaultCampaignId ?? "all");
    });
  }, [campaigns, defaultCampaignId]);

  useEffect(() => {
    fetchWithFirebaseAuth("/api/cargas")
      .then((response) => response.json())
      .then(
        (payload: {
          registros?: Array<
            Omit<RegistroOperacion, "fechaOperacion" | "createdAt"> & {
              fechaOperacion: string | null;
              createdAt: string | null;
            }
          >;
        }) => {
          if (!payload || !Array.isArray(payload.registros)) {
            return;
          }

          setCargaRecords(
            payload.registros.map((record) => ({
              ...record,
              fechaOperacion: record.fechaOperacion
                ? new Date(record.fechaOperacion)
                : null,
              createdAt: record.createdAt ? new Date(record.createdAt) : null,
            })),
          );
        },
      )
      .catch(() => undefined);
  }, []);

  const scopedFilters = useMemo(() => {
    const mergedRange = mergeCampaignDateRange(
      selectedCampaign,
      filters.from,
      filters.to,
    );
    return {
      ...filters,
      ...mergedRange,
    };
  }, [filters, selectedCampaign]);

  const sortedRecords = useMemo(
    () => [...registros].sort(compareRecordsDesc),
    [registros],
  );
  const searchSuggestions = useMemo(
    () =>
      uniqueValues([
        ...sortedRecords.flatMap((record) => [
          record.cliente,
          record.proceso,
          record.procedencia || record.proveedor,
          record.producto,
          ...record.salidas.flatMap((salida) => [
            salida.detalle,
            GRADO_LABELS[salida.grado],
            getProcesoEnvaseLabel(record, salida),
          ]),
        ]),
        ...ingresosRelacionados.flatMap((record) => [
          record.cliente,
          record.proceso,
          record.procedencia || record.proveedor,
          record.producto,
        ]),
      ]),
    [ingresosRelacionados, sortedRecords],
  );

  const filteredRecords = useMemo(() => {
    return sortedRecords.filter((record) =>
      matchesProcessFilters(record, scopedFilters),
    );
  }, [scopedFilters, sortedRecords]);

  const filteredIngresos = useMemo(() => {
    return ingresosRelacionados.filter((record) => {
      const dateKey = formatDateKey(record.fechaOperacion);

      if (!matchesDateRange(dateKey, scopedFilters.from, scopedFilters.to)) {
        return false;
      }

      if (
        scopedFilters.cliente !== "todos" &&
        record.cliente !== scopedFilters.cliente
      ) {
        return false;
      }

      if (
        scopedFilters.proceso !== "todos" &&
        record.proceso !== scopedFilters.proceso
      ) {
        return false;
      }

      if (
        scopedFilters.procedencia !== "todos" &&
        (record.procedencia || record.proveedor || "") !==
          scopedFilters.procedencia
      ) {
        return false;
      }

      if (
        scopedFilters.producto !== "todos" &&
        (record.producto || "Sin producto") !== scopedFilters.producto
      ) {
        return false;
      }

      const query = normalize(scopedFilters.query);

      if (!query) {
        return true;
      }

      return [
        record.cliente,
        record.proceso,
        record.procedencia || record.proveedor,
        record.producto,
      ]
        .filter(Boolean)
        .some((value) => normalize(String(value)).includes(query));
    });
  }, [ingresosRelacionados, scopedFilters]);

  const clienteOptions = useMemo(
    () =>
      uniqueValues(
        sortedRecords
          .filter((record) =>
            matchesProcessFilters(record, scopedFilters, "cliente"),
          )
          .map((record) => record.cliente),
      ),
    [scopedFilters, sortedRecords],
  );
  const procesoOptions = useMemo(
    () =>
      uniqueValues(
        sortedRecords
          .filter((record) =>
            matchesProcessFilters(record, scopedFilters, "proceso"),
          )
          .map((record) => record.proceso),
      ),
    [scopedFilters, sortedRecords],
  );
  const procedenciaOptions = useMemo(
    () =>
      uniqueValues(
        sortedRecords
          .filter((record) =>
            matchesProcessFilters(record, scopedFilters, "procedencia"),
          )
          .map((record) => record.procedencia || record.proveedor || ""),
      ),
    [scopedFilters, sortedRecords],
  );
  const productoOptions = useMemo(
    () =>
      uniqueValues(
        sortedRecords
          .filter((record) =>
            matchesProcessFilters(record, scopedFilters, "producto"),
          )
          .map((record) => record.producto || "Sin producto"),
      ),
    [scopedFilters, sortedRecords],
  );
  const envaseOptions = useMemo(
    () =>
      uniqueValues(
        sortedRecords.flatMap((record) =>
          matchesProcessFilters(record, scopedFilters, "envase")
            ? record.salidas.map((salida) =>
                getProcesoEnvaseLabel(record, salida),
              )
            : [],
        ),
      ),
    [scopedFilters, sortedRecords],
  );
  const gradoOptions = useMemo(
    () =>
      uniqueValues(
        sortedRecords.flatMap((record) =>
          matchesProcessFilters(record, scopedFilters, "grado")
            ? record.salidas.map((salida) => GRADO_LABELS[salida.grado])
            : [],
        ),
      ),
    [scopedFilters, sortedRecords],
  );
  const availableClientes = useMemo(
    () => ["todos", ...clienteOptions],
    [clienteOptions],
  );
  const currentClienteIndex = Math.max(
    0,
    availableClientes.indexOf(filters.cliente),
  );
  const currentClienteLabel =
    filters.cliente === "todos"
      ? "Todos los clientes"
      : (availableClientes[currentClienteIndex] ?? "Sin clientes");
  const totalPages = Math.max(
    1,
    Math.ceil(filteredRecords.length / REGISTROS_POR_PAGINA),
  );
  const visibleRecords = filteredRecords.slice(
    (currentPage - 1) * REGISTROS_POR_PAGINA,
    currentPage * REGISTROS_POR_PAGINA,
  );
  const storedItems = useMemo(
    () => buildStoredItems(filteredRecords, cargaRecords),
    [cargaRecords, filteredRecords],
  );
  const storedTotalPages = Math.max(
    1,
    Math.ceil(storedItems.length / REGISTROS_POR_PAGINA),
  );
  const visibleStoredItems = storedItems.slice(
    (storedCurrentPage - 1) * REGISTROS_POR_PAGINA,
    storedCurrentPage * REGISTROS_POR_PAGINA,
  );

  useEffect(() => {
    setCurrentPage(1);
    setExpandedRecordId(null);
    setStoredCurrentPage(1);
    setExpandedStoredItemId(null);
  }, [
    resolvedSelectedCampaignId,
    scopedFilters.cliente,
    scopedFilters.envase,
    scopedFilters.from,
    scopedFilters.grado,
    scopedFilters.procedencia,
    scopedFilters.producto,
    scopedFilters.proceso,
    scopedFilters.query,
    scopedFilters.to,
  ]);

  useEffect(() => {
    if (
      filters.cliente !== "todos" &&
      !clienteOptions.includes(filters.cliente)
    ) {
      setFilters((currentValue) => ({ ...currentValue, cliente: "todos" }));
    }
  }, [clienteOptions, filters.cliente]);

  useEffect(() => {
    if (
      filters.proceso !== "todos" &&
      !procesoOptions.includes(filters.proceso)
    ) {
      setFilters((currentValue) => ({ ...currentValue, proceso: "todos" }));
    }
  }, [filters.proceso, procesoOptions]);

  useEffect(() => {
    if (
      filters.procedencia !== "todos" &&
      !procedenciaOptions.includes(filters.procedencia)
    ) {
      setFilters((currentValue) => ({ ...currentValue, procedencia: "todos" }));
    }
  }, [filters.procedencia, procedenciaOptions]);

  useEffect(() => {
    if (
      filters.producto !== "todos" &&
      !productoOptions.includes(filters.producto)
    ) {
      setFilters((currentValue) => ({ ...currentValue, producto: "todos" }));
    }
  }, [filters.producto, productoOptions]);

  useEffect(() => {
    if (filters.envase !== "todos" && !envaseOptions.includes(filters.envase)) {
      setFilters((currentValue) => ({ ...currentValue, envase: "todos" }));
    }
  }, [envaseOptions, filters.envase]);

  useEffect(() => {
    if (filters.grado !== "todos" && !gradoOptions.includes(filters.grado)) {
      setFilters((currentValue) => ({ ...currentValue, grado: "todos" }));
    }
  }, [filters.grado, gradoOptions]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (storedCurrentPage > storedTotalPages) {
      setStoredCurrentPage(storedTotalPages);
    }
  }, [storedCurrentPage, storedTotalPages]);

  function cycleCliente(direction: -1 | 1) {
    const nextIndex =
      (currentClienteIndex + direction + availableClientes.length) %
      availableClientes.length;
    setFilters((currentValue) => ({
      ...currentValue,
      cliente: availableClientes[nextIndex] ?? "todos",
    }));
  }

  async function handleDelete(record: RegistroProceso) {
    const confirmed = window.confirm(
      `Va a eliminar el proceso ${record.proceso} del ${formatDisplayDate(record.fechaProceso)}.`,
    );

    if (!confirmed) {
      return;
    }

    setPendingActionId(record.id);
    setFeedback(null);

    try {
      const response = await fetchWithFirebaseAuth("/api/procesos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ procesoId: record.id }),
      });
      const result =
        (await response.json()) as ActionState<ProcesoMutationData>;

      if (!result.ok) {
        setFeedback({ tone: "error", message: result.message });
        return;
      }

      setExpandedRecordId((currentValue) =>
        currentValue === record.id ? null : currentValue,
      );
      setFeedback({ tone: "success", message: result.message });
      refreshAllModuleData();
    } catch (error) {
      setFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "No fue posible eliminar el proceso.",
      });
    } finally {
      setPendingActionId(null);
    }
  }

  async function handleStoredItemAction(
    item: ProcesoStoredItem,
    accion: "eliminar_salida" | "reprocesar_salida",
  ) {
    const actionLabel =
      accion === "reprocesar_salida" ? "reprocesar" : "eliminar";
    const confirmed = window.confirm(
      `Va a ${actionLabel} la salida ${item.detalle} de ${item.cliente} - ${item.proceso}.`,
    );

    if (!confirmed) {
      return;
    }

    setPendingActionId(item.id);
    setFeedback(null);

    try {
      const response = await fetchWithFirebaseAuth("/api/procesos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accion,
          procesoId: item.procesoId,
          salidaId: item.salidaId,
        }),
      });
      const result =
        (await response.json()) as ActionState<ProcesoMutationData>;

      if (!result.ok) {
        setFeedback({ tone: "error", message: result.message });
        return;
      }

      setFeedback({ tone: "success", message: result.message });
      refreshAllModuleData();
    } catch (error) {
      setFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : `No fue posible ${actionLabel} la salida.`,
      });
    } finally {
      setPendingActionId(null);
    }
  }

  const kilosNatural = filteredIngresos.reduce(
    (total, record) => total + record.kilos,
    0,
  );
  const kilosProcesado = filteredRecords.reduce(
    (total, record) => total + Number(record.kilosProcesado ?? 0),
    0,
  );
  const kilosNoRecuperable = filteredRecords.reduce(
    (total, record) => total + Number(record.kilosNoRecuperable ?? 0),
    0,
  );
  const kilosAlmacenados = storedItems.reduce(
    (total, item) => total + item.kilos,
    0,
  );
  const kilosReprocesados = filteredRecords.reduce(
    (total, record) => total + Number(record.kilosReprocesados ?? 0),
    0,
  );

  return (
    <>
      <ConsoleShell
        active="procesos"
        firestoreDisponible={firestoreDisponible}
        footerHint="Procesos conectados con ingresos relacionales y preparados para descontar mercaderia y envases en la siguiente etapa."
        footerLabel={
          firestoreDisponible ? "Procesos online" : "Procesos pendientes"
        }
      >
        <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="flex items-center gap-3 font-display text-4xl font-bold text-[var(--text)]">
              <span>Procesos</span>
              <ModuleLoadingIndicator isLoading={isLoading} />
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-soft)]">
              Registro de procesamiento con multiples salidas, mercaderia
              almacenada y trazabilidad relacional contra los ingresos
              disponibles.
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <ModuleSearchBox
              className="w-full min-w-0 sm:w-80"
              onChange={(value) =>
                setFilters((currentValue) => ({
                  ...currentValue,
                  query: value,
                }))
              }
              placeholder="Buscar cliente, proceso, producto o detalle"
              suggestions={searchSuggestions}
              value={filters.query}
            />
            <button
              className="primary-action-button rounded-xl px-5 py-3 text-xs font-black text-[var(--primary-ink)] transition hover:brightness-110"
              onClick={() => setIsCreateModalOpen(true)}
              type="button"
            >
              Nuevo proceso
            </button>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            helper="Kg ingresados visibles"
            label="Natural"
            value={formatToneladasFromKg(kilosNatural)}
          />
          <MetricCard
            helper="Exportacion + recupero"
            label="Procesado"
            value={formatToneladasFromKg(kilosProcesado)}
          />
          <MetricCard
            helper="Salidas descartadas"
            label="No recuperable"
            value={formatToneladasFromKg(kilosNoRecuperable)}
          />
          <MetricCard
            helper="Mercaderia almacenada activa"
            label="Almacenado"
            value={formatToneladasFromKg(kilosAlmacenados)}
          />
          <MetricCard
            helper="Ordenes reprocesadas"
            label="Reprocesado"
            value={formatToneladasFromKg(kilosReprocesados)}
          />
        </section>

        <ModuleIntegratedFilters
          campaigns={campaigns}
          currentClientLabel={currentClienteLabel}
          filtersClassName="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-7"
          isOpen={isFiltersOpen}
          onChangeCampaign={setSelectedCampaignId}
          onClear={() => {
            setSelectedCampaignId("all");
            setFilters({
              cliente: "todos",
              envase: "todos",
              from: "",
              grado: "todos",
              procedencia: "todos",
              producto: "todos",
              proceso: "todos",
              query: "",
              to: "",
            });
          }}
          onNextClient={() => cycleCliente(1)}
          onPrevClient={() => cycleCliente(-1)}
          onToggle={() => setIsFiltersOpen((currentValue) => !currentValue)}
          selectedCampaignId={resolvedSelectedCampaignId}
        >
          <ModuleFilterField label="Desde">
            <input
              className="aether-field h-10 py-2 text-sm"
              onChange={(event) =>
                setFilters((currentValue) => ({
                  ...currentValue,
                  from: event.target.value,
                }))
              }
              type="date"
              value={filters.from}
            />
          </ModuleFilterField>
          <ModuleFilterField label="Hasta">
            <input
              className="aether-field h-10 py-2 text-sm"
              onChange={(event) =>
                setFilters((currentValue) => ({
                  ...currentValue,
                  to: event.target.value,
                }))
              }
              type="date"
              value={filters.to}
            />
          </ModuleFilterField>
          <FilterSelect
            label="Proceso"
            onChange={(value) =>
              setFilters((currentValue) => ({
                ...currentValue,
                proceso: value,
              }))
            }
            options={procesoOptions}
            value={filters.proceso}
          />
          <FilterSelect
            label="Procedencia"
            onChange={(value) =>
              setFilters((currentValue) => ({
                ...currentValue,
                procedencia: value,
              }))
            }
            options={procedenciaOptions}
            value={filters.procedencia}
          />
          <FilterSelect
            label="Producto"
            onChange={(value) =>
              setFilters((currentValue) => ({
                ...currentValue,
                producto: value,
              }))
            }
            options={productoOptions}
            value={filters.producto}
          />
          <FilterSelect
            label="Envase"
            onChange={(value) =>
              setFilters((currentValue) => ({ ...currentValue, envase: value }))
            }
            options={envaseOptions}
            value={filters.envase}
          />
          <FilterSelect
            label="Grado"
            onChange={(value) =>
              setFilters((currentValue) => ({ ...currentValue, grado: value }))
            }
            options={gradoOptions}
            value={filters.grado}
          />
        </ModuleIntegratedFilters>

        {loadError ? (
          <div className="aether-panel rounded-2xl px-4 py-3 text-sm font-semibold text-[var(--warning)]">
            {loadError}
          </div>
        ) : null}

        {feedback ? (
          <div
            className={`rounded-2xl px-4 py-3 text-sm font-semibold ring-1 ${
              feedback.tone === "success"
                ? "bg-emerald-50 text-emerald-800 ring-emerald-100"
                : "bg-red-50 text-red-800 ring-red-100"
            }`}
          >
            {feedback.message}
          </div>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <section className="aether-panel rounded-2xl p-4 md:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-display text-base font-bold text-[var(--text)]">
                  Historial de procesos
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Se muestran los ultimos 8 registros por pagina.
                </p>
              </div>
              <span className="rounded-full bg-[var(--surface-low)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-soft)] ring-1 ring-[var(--line)]">
                {filteredRecords.length} registros
              </span>
            </div>

            <div className="mt-4 grid gap-3">
              {visibleRecords.length > 0 ? (
                visibleRecords.map((record) => (
                  <HistorialCard
                    expanded={expandedRecordId === record.id}
                    isPending={pendingActionId === record.id}
                    key={record.id}
                    onDelete={() => void handleDelete(record)}
                    onEdit={() => setEditingRecord(record)}
                    onToggle={() =>
                      setExpandedRecordId((currentValue) =>
                        currentValue === record.id ? null : record.id,
                      )
                    }
                    record={record}
                  />
                ))
              ) : (
                <div className="empty-state grid min-h-44 place-items-center rounded-2xl px-6 text-center text-sm font-semibold text-[var(--text-muted)]">
                  No hay procesos para los filtros seleccionados.
                </div>
              )}
            </div>

            <PaginationControls
              currentPage={currentPage}
              onPageChange={setCurrentPage}
              totalPages={totalPages}
            />
          </section>

          <section className="aether-panel rounded-2xl p-4 md:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-display text-base font-bold text-[var(--text)]">
                  Mercaderia almacenada
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Lotes activos listos para egreso. Puedes editar, eliminar o
                  reprocesar.
                </p>
              </div>
              <span className="rounded-full bg-[var(--surface-low)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-soft)] ring-1 ring-[var(--line)]">
                {storedItems.length} lotes
              </span>
            </div>

            <div className="mt-4 grid gap-3">
              {storedItems.length > 0 ? (
                visibleStoredItems.map((item) => (
                  <StoredItemCard
                    expanded={expandedStoredItemId === item.id}
                    item={item}
                    key={item.id}
                    onDelete={() =>
                      void handleStoredItemAction(item, "eliminar_salida")
                    }
                    onEdit={() => {
                      const parentRecord =
                        sortedRecords.find(
                          (record) => record.id === item.procesoId,
                        ) ?? null;
                      setEditingRecord(parentRecord);
                    }}
                    onReprocess={() =>
                      void handleStoredItemAction(item, "reprocesar_salida")
                    }
                    onToggle={() =>
                      setExpandedStoredItemId((currentValue) =>
                        currentValue === item.id ? null : item.id,
                      )
                    }
                    pendingAction={pendingActionId === item.id}
                  />
                ))
              ) : (
                <div className="empty-state grid min-h-44 place-items-center rounded-2xl px-6 text-center text-sm font-semibold text-[var(--text-muted)]">
                  No hay mercaderia almacenada para los filtros activos.
                </div>
              )}
            </div>
            <PaginationControls
              currentPage={storedCurrentPage}
              onPageChange={setStoredCurrentPage}
              totalPages={storedTotalPages}
            />
          </section>
        </section>
      </ConsoleShell>

      {isCreateModalOpen ? (
        <ProcessModal
          envases={envases}
          onClose={() => setIsCreateModalOpen(false)}
          onSuccess={(message) => {
            setFeedback({ tone: "success", message });
            setIsCreateModalOpen(false);
          }}
          recordToEdit={null}
          relationRecords={ingresosRelacionados}
        />
      ) : null}

      {editingRecord ? (
        <ProcessModal
          envases={envases}
          onClose={() => setEditingRecord(null)}
          onSuccess={(message) => {
            setFeedback({ tone: "success", message });
            setEditingRecord(null);
          }}
          recordToEdit={editingRecord}
          relationRecords={ingresosRelacionados}
        />
      ) : null}
    </>
  );
}

function ModalField({
  children,
  className,
  error,
  label,
}: {
  children: ReactNode;
  className?: string;
  error?: string;
  label: string;
}) {
  return (
    <label
      className={`grid gap-2 text-xs font-bold text-[var(--modal-muted)] ${className ?? ""}`}
    >
      {label}
      {children}
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </label>
  );
}

function ModalAutocompleteField({
  datalistId,
  error,
  label,
  options,
  placeholder,
  registration,
}: {
  datalistId: string;
  error?: string;
  label: string;
  options: string[];
  placeholder: string;
  registration: any;
}) {
  return (
    <ModalField error={error} label={label}>
      <>
        <input
          className="modal-field"
          list={datalistId}
          placeholder={placeholder}
          {...registration}
        />
        <datalist id={datalistId}>
          {options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </>
    </ModalField>
  );
}

function ProcessModal({
  envases,
  onClose,
  onSuccess,
  recordToEdit,
  relationRecords,
}: {
  envases: EnvaseOption[];
  onClose: () => void;
  onSuccess: (message: string) => void;
  recordToEdit: RegistroProceso | null;
  relationRecords: RegistroOperacion[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [plantStockOptions, setPlantStockOptions] = useState<
    PlantStockOption[]
  >([]);
  const todayValue = getTodayLocalInputValue();
  const initialSeed = useMemo(
    () => buildProcessFormSeed(recordToEdit, todayValue),
    [recordToEdit, todayValue],
  );
  const autoFilledFieldsRef = useRef<Set<RelationalFieldKey>>(new Set());
  const manualFieldsRef = useRef<Set<RelationalFieldKey>>(new Set());
  const isEditMode = Boolean(recordToEdit);
  const form = useForm<ProcesoRegistroFormInput>({
    resolver: zodResolver(procesoRegistroFormSchema),
    defaultValues: initialSeed.values,
  });
  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: "salidas",
  });
  const cliente = form.watch("cliente");
  const procedencia = form.watch("procedencia");
  const proceso = form.watch("proceso");
  const producto = form.watch("producto");
  const salidas = useWatch({
    control: form.control,
    name: "salidas",
  });
  const relationalValues = useMemo(
    () => ({
      cliente,
      proceso,
      procedencia,
      producto,
    }),
    [cliente, proceso, procedencia, producto],
  );
  const relationalOptions = useMemo(() => {
    return RELATIONAL_FIELDS.reduce<Record<RelationalFieldKey, string[]>>(
      (accumulator, field) => {
        accumulator[field] = uniqueValues(
          relationRecords
            .filter((record) =>
              matchesRelationalFieldSet(record, relationalValues, field),
            )
            .map((record) => getRelationFieldValue(record, field)),
        );
        return accumulator;
      },
      {
        cliente: [],
        proceso: [],
        procedencia: [],
        producto: [],
      },
    );
  }, [relationRecords, relationalValues]);
  const selectedEnvaseIds = useMemo(
    () =>
      new Set(
        (salidas ?? [])
          .map((salida) => (salida?.inventoryId ?? "").trim())
          .filter(Boolean),
      ),
    [salidas],
  );
  const envaseOptions = useMemo(() => {
    const optionMap = new Map<string, PlantStockOption>();

    for (const entry of plantStockOptions) {
      if (entry.cantidad > 0 || selectedEnvaseIds.has(entry.inventoryId)) {
        optionMap.set(entry.inventoryId, entry);
      }
    }

    for (const salida of salidas ?? []) {
      const inventoryId = (salida.inventoryId ?? "").trim();

      if (!inventoryId || optionMap.has(inventoryId)) {
        continue;
      }

      optionMap.set(inventoryId, {
        inventoryId,
        visibleId:
          salida.envaseVisibleId ||
          `${salida.envaseTipoId || "Sin envase"} | ${salida.envaseEstado || "Sin estado"} | ${Number(
            salida.envaseKilos ?? 0,
          )} kg`,
        envaseTipoId: salida.envaseTipoId ?? "",
        envaseTipoNombre:
          salida.envaseVisibleId || salida.envaseTipoId || "Sin envase",
        envaseEstado: salida.envaseEstado ?? "",
        kilos: Number(salida.envaseKilos ?? 0),
        cantidad: Number(salida.cantidadEnvases ?? 0),
      });
    }

    return [...optionMap.values()].sort((a, b) => {
      if (b.kilos !== a.kilos) {
        return b.kilos - a.kilos;
      }

      return a.visibleId.localeCompare(b.visibleId, "es");
    });
  }, [plantStockOptions, salidas, selectedEnvaseIds]);
  const totalKilos = useMemo(
    () =>
      (salidas ?? []).reduce(
        (total, salida) => total + Number(salida?.kilos ?? 0),
        0,
      ),
    [salidas],
  );

  function buildEmptySalida() {
    return {
      grado: "exportacion" as const,
      detalle: "Procesado",
      kilos: 0,
      cantidadEnvases: 0,
      envaseTipoId: "",
      inventoryId: "",
      envaseEstado: "",
      envaseKilos: 0,
      envaseVisibleId: "",
    };
  }

  function recalculateTotalKilos() {
    const nextSalidas = (form.getValues("salidas") ?? []).map((salida) => ({
      ...salida,
      kilos: Number(salida?.kilos ?? 0),
      cantidadEnvases: Number(salida?.cantidadEnvases ?? 0),
    }));

    form.setValue("salidas", nextSalidas, {
      shouldDirty: true,
      shouldValidate: false,
    });
  }

  function registerRelationalField(field: RelationalFieldKey, options?: any) {
    return form.register(field, {
      ...(options ?? {}),
      onChange: (event: any) => {
        autoFilledFieldsRef.current.delete(field);
        manualFieldsRef.current.add(field);
        options?.onChange?.(event);
      },
    });
  }

  useEffect(() => {
    autoFilledFieldsRef.current = new Set();
    manualFieldsRef.current = new Set();
    setServerError(null);
    form.reset(initialSeed.values);
  }, [form, initialSeed]);

  useEffect(() => {
    fetchWithFirebaseAuth("/api/envases")
      .then((response) => response.json())
      .then((payload) => {
        if (!payload || !Array.isArray(payload.stockPlanta)) {
          return;
        }

        const nextOptions = payload.stockPlanta.flatMap(
          (group: { entries?: PlantStockOption[] }) =>
            Array.isArray(group.entries) ? group.entries : [],
        );
        setPlantStockOptions(nextOptions);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const { nextAutoFilledFields, updates } = syncRelationalAutoFilledFields({
      autoFilledFields: autoFilledFieldsRef.current,
      fields: RELATIONAL_FIELDS,
      getValue: (field) => (form.getValues(field) ?? "").trim(),
      manualFields: manualFieldsRef.current,
      optionsByField: relationalOptions,
    });

    autoFilledFieldsRef.current = nextAutoFilledFields;
    updates.forEach((update) => {
      form.setValue(update.field, update.value, {
        shouldDirty: false,
        shouldValidate: update.value.length > 0,
      });
    });
  }, [form, relationalOptions]);

  const handleSubmit = form.handleSubmit((values) => {
    setServerError(null);

    startTransition(async () => {
      try {
        const normalizedSalidas = values.salidas.map((salida) => ({
          id: salida.id,
          grado: salida.grado,
          detalle: salida.detalle.trim(),
          kilos: Number(salida.kilos ?? 0),
          cantidadEnvases: Number(salida.cantidadEnvases ?? 0),
          envaseTipoId: (salida.envaseTipoId ?? "").trim(),
          inventoryId: (salida.inventoryId ?? "").trim(),
          envaseEstado: (salida.envaseEstado ?? "").trim(),
          envaseKilos: Number(salida.envaseKilos ?? 0),
          envaseVisibleId: (salida.envaseVisibleId ?? "").trim(),
        }));

        const response = recordToEdit
          ? await fetchWithFirebaseAuth("/api/procesos", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                accion: "actualizar",
                procesoId: recordToEdit.id,
                fechaProceso: values.fechaProceso,
                cliente: values.cliente,
                proceso: values.proceso,
                procedencia: values.procedencia ?? "",
                producto: values.producto ?? "",
                tipoOrden: values.tipoOrden,
                salidas: normalizedSalidas,
                observaciones: values.observaciones ?? "",
              }),
            })
          : await (() => {
              const formData = new FormData();
              formData.set("fechaProceso", values.fechaProceso);
              formData.set("cliente", values.cliente);
              formData.set("proceso", values.proceso);
              formData.set("procedencia", values.procedencia ?? "");
              formData.set("producto", values.producto ?? "");
              formData.set("tipoOrden", values.tipoOrden);
              formData.set("salidas", JSON.stringify(normalizedSalidas));
              formData.set("observaciones", values.observaciones ?? "");
              return fetchWithFirebaseAuth("/api/procesos", {
                method: "POST",
                body: formData,
              });
            })();
        const result =
          (await response.json()) as ActionState<ProcesoMutationData>;

        if (!result.ok) {
          setServerError(result.message);
          return;
        }

        refreshAllModuleData();
        router.refresh();
        onSuccess(result.message);
      } catch (error) {
        setServerError(
          error instanceof Error
            ? error.message
            : `No fue posible ${isEditMode ? "actualizar" : "registrar"} el proceso.`,
        );
      }
    });
  });

  return (
    <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <section className="modal-shell max-h-[94vh] w-full max-w-6xl overflow-hidden rounded-2xl bg-[var(--modal-surface)] text-[var(--modal-ink)] ring-1 ring-[rgba(226,232,240,0.7)] backdrop-blur-2xl">
        <div className="modal-topbar flex items-start justify-between gap-6 border-b border-[var(--modal-line)] px-8 py-7">
          <div>
            <h2 className="font-display text-3xl font-bold text-[var(--modal-ink)]">
              {isEditMode ? "Editar proceso" : "Registrar proceso"}
            </h2>
            <p className="mt-2 text-sm text-[var(--modal-muted)]">
              Registre varias salidas vinculadas al mismo proceso con
              comportamiento relacional sobre cliente, procedencia y producto.
            </p>
          </div>
          <button
            className="rounded-xl px-3 py-2 text-lg font-bold text-[var(--modal-muted)] hover:bg-slate-100 hover:text-sky-600"
            onClick={onClose}
            type="button"
          >
            x
          </button>
        </div>

        <form
          className="max-h-[calc(94vh-112px)] overflow-y-auto"
          onSubmit={handleSubmit}
        >
          <div className="grid gap-8 px-8 py-7">
            <section className="grid gap-6 rounded-2xl bg-slate-50/80 p-5 ring-1 ring-[var(--modal-line)]">
              <div className="grid gap-x-12 gap-y-7 md:grid-cols-2">
                <div className="grid gap-7">
                  <ModalField
                    error={form.formState.errors.fechaProceso?.message}
                    label="Fecha*"
                  >
                    <input
                      className="modal-field"
                      type="date"
                      {...form.register("fechaProceso")}
                    />
                  </ModalField>
                  <ModalAutocompleteField
                    datalistId="procesos-cliente-opciones"
                    error={form.formState.errors.cliente?.message}
                    label="Cliente*"
                    options={relationalOptions.cliente}
                    placeholder="Cliente"
                    registration={registerRelationalField("cliente")}
                  />
                  <ModalAutocompleteField
                    datalistId="procesos-proceso-opciones"
                    error={form.formState.errors.proceso?.message}
                    label="Proceso*"
                    options={relationalOptions.proceso}
                    placeholder="Proceso"
                    registration={registerRelationalField("proceso")}
                  />
                </div>
                <div className="grid gap-7">
                  <ModalAutocompleteField
                    datalistId="procesos-procedencia-opciones"
                    error={form.formState.errors.procedencia?.message}
                    label="Procedencia"
                    options={relationalOptions.procedencia}
                    placeholder="Procedencia"
                    registration={registerRelationalField("procedencia")}
                  />
                  <ModalAutocompleteField
                    datalistId="procesos-producto-opciones"
                    error={form.formState.errors.producto?.message}
                    label="Producto"
                    options={relationalOptions.producto}
                    placeholder="Producto"
                    registration={registerRelationalField("producto")}
                  />
                  <ModalField
                    error={form.formState.errors.tipoOrden?.message}
                    label="Tipo de orden*"
                  >
                    <select
                      className="modal-field bg-white"
                      {...form.register("tipoOrden")}
                    >
                      <option value="procesado">Procesado</option>
                      <option value="reprocesado">Reprocesado</option>
                    </select>
                  </ModalField>
                </div>
              </div>
            </section>

            <section className="grid gap-4 rounded-2xl bg-slate-50/80 p-5 ring-1 ring-[var(--modal-line)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-display text-lg font-bold text-[var(--modal-ink)]">
                    Salidas del proceso
                  </p>
                  <p className="mt-1 text-sm text-[var(--modal-muted)]">
                    Configure tantas salidas como necesite antes de guardar.
                  </p>
                </div>
                <button
                  className="console-secondary-button rounded-xl px-4 py-2 text-xs font-bold"
                  onClick={() => append(buildEmptySalida())}
                  type="button"
                >
                  Agregar
                </button>
              </div>
              <div className="grid gap-3">
                {fields.map((field, index) => (
                  <div
                    className="grid gap-3 rounded-2xl bg-white px-4 py-4 ring-1 ring-[var(--modal-line)] lg:grid-cols-[minmax(110px,0.85fr)_minmax(0,1.15fr)_140px_minmax(260px,1.35fr)_130px_auto]"
                    key={field.id}
                  >
                    <ModalField
                      error={
                        form.formState.errors.salidas?.[index]?.grado?.message
                      }
                      label="Grado"
                    >
                      <select
                        className="modal-field bg-white"
                        {...form.register(`salidas.${index}.grado`)}
                      >
                        <option value="exportacion">Exportacion</option>
                        <option value="recupero">Recupero</option>
                        <option value="no_recuperable">No recuperable</option>
                      </select>
                    </ModalField>
                    <ModalAutocompleteField
                      datalistId={`procesos-detalle-${index}`}
                      error={
                        form.formState.errors.salidas?.[index]?.detalle?.message
                      }
                      label="Detalle"
                      options={DETALLE_SUGGESTIONS}
                      placeholder="Detalle"
                      registration={form.register(`salidas.${index}.detalle`)}
                    />
                    <ModalField
                      error={
                        form.formState.errors.salidas?.[index]?.kilos?.message
                      }
                      label="Kg envasados"
                    >
                      <input
                        className="modal-field"
                        min="0"
                        step="0.01"
                        type="number"
                        {...form.register(`salidas.${index}.kilos`, {
                          valueAsNumber: true,
                        })}
                      />
                    </ModalField>
                    <ModalField label="Envases">
                      <select
                        className="modal-field bg-white text-sm"
                        onChange={(event) => {
                          const selectedInventoryId = event.target.value;
                          const selectedEntry =
                            envaseOptions.find(
                              (entry) =>
                                entry.inventoryId === selectedInventoryId,
                            ) ?? null;
                          form.setValue(
                            `salidas.${index}.inventoryId`,
                            selectedInventoryId,
                            { shouldDirty: true, shouldValidate: true },
                          );
                          form.setValue(
                            `salidas.${index}.envaseTipoId`,
                            selectedEntry?.envaseTipoId ?? "",
                            { shouldDirty: true, shouldValidate: true },
                          );
                          form.setValue(
                            `salidas.${index}.envaseEstado`,
                            selectedEntry?.envaseEstado ?? "",
                            { shouldDirty: true, shouldValidate: false },
                          );
                          form.setValue(
                            `salidas.${index}.envaseKilos`,
                            Number(selectedEntry?.kilos ?? 0),
                            { shouldDirty: true, shouldValidate: false },
                          );
                          form.setValue(
                            `salidas.${index}.envaseVisibleId`,
                            selectedEntry?.visibleId ?? "",
                            { shouldDirty: true, shouldValidate: false },
                          );
                        }}
                        title={
                          form.watch(`salidas.${index}.envaseVisibleId`) ||
                          "Sin seleccionar"
                        }
                        value={form.watch(`salidas.${index}.inventoryId`) || ""}
                      >
                        <option value="">Sin seleccionar</option>
                        {envaseOptions.map((entry) => (
                          <option
                            key={entry.inventoryId}
                            value={entry.inventoryId}
                          >
                            {entry.visibleId} ({formatNumber(entry.cantidad, 0)}
                            )
                          </option>
                        ))}
                      </select>
                      <span className="text-[11px] font-semibold normal-case tracking-normal text-[var(--modal-muted)]">
                        ID del stock general con cantidad disponible en tiempo
                        real.
                      </span>
                    </ModalField>
                    <ModalField
                      error={
                        form.formState.errors.salidas?.[index]?.cantidadEnvases
                          ?.message
                      }
                      label="Cant. envase"
                    >
                      <input
                        className="modal-field"
                        min="0"
                        step="1"
                        type="number"
                        {...form.register(`salidas.${index}.cantidadEnvases`, {
                          valueAsNumber: true,
                        })}
                      />
                    </ModalField>
                    <div className="flex items-end">
                      <button
                        className="console-danger-button h-12 w-full rounded-xl px-3 text-xs font-bold"
                        onClick={() => {
                          if (fields.length === 1) {
                            replace([buildEmptySalida()]);
                            return;
                          }

                          remove(index);
                        }}
                        type="button"
                      >
                        Quitar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <ModalField
              error={form.formState.errors.observaciones?.message}
              label="Observaciones"
            >
              <textarea
                className="modal-field min-h-28 resize-none py-3"
                placeholder="Observaciones operativas"
                {...form.register("observaciones")}
              />
            </ModalField>

            {serverError ? (
              <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 ring-1 ring-red-100">
                {serverError}
              </div>
            ) : null}
          </div>

          <div className="modal-footer sticky bottom-0 flex flex-col gap-4 border-t border-[var(--modal-line)] bg-[var(--modal-surface)]/96 px-8 py-5 backdrop-blur md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3 rounded-2xl bg-[var(--modal-surface-alt)] px-4 py-3 ring-1 ring-[var(--modal-line)]">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[var(--modal-muted)]">
                  Total del proceso
                </p>
                <p className="mt-1 font-display text-2xl font-bold text-[var(--modal-ink)]">
                  {formatKilos(totalKilos)}
                </p>
              </div>
              <button
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-[var(--modal-muted)] ring-1 ring-[var(--modal-line)] transition hover:text-sky-600"
                onClick={recalculateTotalKilos}
                title="Calcular total"
                type="button"
              >
                <RefreshIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="console-secondary-button rounded-xl px-5 py-3 text-xs font-bold"
                onClick={onClose}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="primary-action-button rounded-xl px-6 py-3 text-xs font-black text-[var(--primary-ink)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isPending}
                type="submit"
              >
                {isPending
                  ? "Guardando..."
                  : isEditMode
                    ? "Guardar cambios"
                    : "Registrar proceso"}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
