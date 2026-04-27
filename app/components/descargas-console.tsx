"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm } from "react-hook-form";
import { ConsoleShell } from "@/app/components/console-shell";
import { ModuleIntegratedFilters } from "@/app/components/module-integrated-filters";
import { ModuleLoadingIndicator } from "@/app/components/module-loading-indicator";
import { ModuleSearchBox } from "@/app/components/module-search-box";
import { AutoFitMetricValue } from "@/app/components/auto-fit-metric-value";
import { fetchWithFirebaseAuth } from "@/lib/client/auth-fetch";
import {
  getDefaultCampaignId,
  mergeCampaignDateRange,
  resolveCampaignPeriod,
  useCampaignPeriods,
} from "@/lib/client/campaign-periods";
import { syncRelationalAutoFilledFields } from "@/lib/client/relational-autofill";
import { refreshAllModuleData } from "@/lib/client/module-data";
import type {
  EnvaseOption,
  OperacionMutationData,
  RegistroOperacion,
} from "@/lib/services/operaciones";
import {
  compactarEspacios,
  construirEnvaseInventoryId,
  construirEnvaseTipoIdManual,
} from "@/lib/utils";
import {
  operacionIngresoFormSchema,
  type ActionState,
  type OperacionIngresoFormInput,
} from "@/types/schema";

type DescargasConsoleProps = {
  registros: RegistroOperacion[];
  envases: EnvaseOption[];
  deepLinkIntent?: "edit" | "delete";
  deepLinkRecordId?: string;
  deepLinkSource?: "envases";
  firestoreDisponible: boolean;
  isLoading?: boolean;
  loadError?: string | null;
  storageConfigurado: boolean;
};

type DescargasFilters = {
  query: string;
  from: string;
  to: string;
  cliente: string;
  proceso: string;
  producto: string;
  proveedor: string;
};

type SegmentMode = "proceso" | "cliente" | "producto";
type DateChartMode = "month" | "year";

type IngresoFormSeed = {
  values: OperacionIngresoFormInput;
  hasCartaPorte: boolean;
  hasEnvases: boolean;
  envasesNoMapeados: number;
};

type RelationalFieldKey = "cliente" | "producto" | "proceso" | "proveedor";

type DateChartEntry = {
  id: string;
  label: string;
  subtitle: string;
  kilos: number;
};

type DateChartPoint = {
  id: string;
  axisLabel: string;
  kilos: number;
  entries: DateChartEntry[];
  summaryLabel: string;
  xRatio: number;
};

const SIN_ENVASE_TIPO_ID = "sin-envases";
const SIN_ENVASE_ESTADO = "Sin envases";
const SIN_ENVASE_NOMBRE = "Sin envases";
const DESCARGA_GRANEL_LABEL = "DESCARGA A GRANEL";
const DESCARGA_GRANEL_ESTADO = "A granel";
const DEFAULT_DESCARGA_ENVASE = {
  inventoryId: "",
  envaseTipoId: "BOLSON",
  envaseTipoNombre: "BOLSON",
  envaseEstado: "USADO",
  kilos: 1000,
  cantidad: 1,
} as const;
const SEGMENT_ORDER: SegmentMode[] = ["proceso", "cliente", "producto"];
const REGISTROS_POR_PAGINA = 8;
const SEGMENTOS_POR_PAGINA = 5;
const RELATIONAL_FIELDS: RelationalFieldKey[] = [
  "cliente",
  "producto",
  "proceso",
  "proveedor",
];

function isGranelPlaceholderDetail(detail: {
  cantidad?: number;
  envaseTipoId?: string;
  envaseTipoNombre?: string;
}) {
  const label = (detail.envaseTipoNombre ?? detail.envaseTipoId ?? "")
    .trim()
    .toUpperCase();

  return label === DESCARGA_GRANEL_LABEL && Number(detail.cantidad ?? 0) <= 0;
}
const SEGMENT_THEME: Record<
  SegmentMode,
  {
    accent: string;
    accentSoft: string;
    glow: string;
    pillBg: string;
    pillText: string;
  }
> = {
  proceso: {
    accent: "#4ec7ff",
    accentSoft: "#7ee7ff",
    glow: "rgba(78, 199, 255, 0.35)",
    pillBg: "rgba(78, 199, 255, 0.14)",
    pillText: "#0b5a74",
  },
  cliente: {
    accent: "#2fc7a2",
    accentSoft: "#7fe7c8",
    glow: "rgba(47, 199, 162, 0.3)",
    pillBg: "rgba(47, 199, 162, 0.14)",
    pillText: "#0d6955",
  },
  producto: {
    accent: "#f4ae52",
    accentSoft: "#ffd38a",
    glow: "rgba(244, 174, 82, 0.3)",
    pillBg: "rgba(244, 174, 82, 0.14)",
    pillText: "#8a5200",
  },
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function uniqueValues(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "es"),
  );
}

function formatDateKey(value: Date | null) {
  if (!value) {
    return "";
  }

  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

function formatMonthKey(value: Date | null) {
  if (!value) {
    return "";
  }

  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}`;
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

function formatChartDay(value: Date | null) {
  if (!value) {
    return "--/--";
  }

  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
  }).format(value);
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);

  if (!year || !month) {
    return "Sin periodo";
  }

  return new Intl.DateTimeFormat("es-AR", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

function formatMonthShort(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);

  if (!year || !month) {
    return "--";
  }

  return new Intl.DateTimeFormat("es-AR", {
    month: "short",
  })
    .format(new Date(year, month - 1, 1))
    .replace(".", "");
}

function getDaysInMonth(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);

  if (!year || !month) {
    return 30;
  }

  return new Date(year, month, 0).getDate();
}

function formatNumber(value: number, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("es-AR", {
    maximumFractionDigits,
  }).format(value);
}

function formatKilos(value: number) {
  return `${formatNumber(value)} Kg`;
}

function formatToneladasFromKg(value: number) {
  return `${formatNumber(value / 1000, 2)} TN`;
}

function buildGeneratedCartaPorte() {
  return `MANUAL-${Date.now()}`;
}

function isGeneratedCartaPorte(value: string) {
  return value.startsWith("MANUAL-");
}

function getRecordSortValue(record: RegistroOperacion) {
  return record.fechaOperacion?.getTime() ?? record.createdAt?.getTime() ?? 0;
}

function compareRecordsDesc(a: RegistroOperacion, b: RegistroOperacion) {
  return getRecordSortValue(b) - getRecordSortValue(a);
}

function matchesDescargaFilters(
  record: RegistroOperacion,
  filters: DescargasFilters,
  ignoredField?: keyof DescargasFilters,
) {
  const normalizedQuery = normalize(filters.query.trim());
  const haystack = normalize(
    [
      record.producto ?? "",
      record.cliente,
      record.proceso,
      record.proveedor,
      record.procedencia,
      record.numeroCartaPorte,
      record.observaciones ?? "",
      ...record.detalleEnvases.map(
        (detail) =>
          `${detail.envaseTipoNombre} ${detail.envaseEstado} ${detail.cantidad} ${detail.kilos}`,
      ),
    ].join(" "),
  );
  const recordDate = formatDateKey(record.fechaOperacion);

  return (
    (ignoredField === "cliente" ||
      filters.cliente === "todos" ||
      record.cliente === filters.cliente) &&
    (ignoredField === "proceso" ||
      filters.proceso === "todos" ||
      record.proceso === filters.proceso) &&
    (ignoredField === "producto" ||
      filters.producto === "todos" ||
      (record.producto ?? "Sin producto") === filters.producto) &&
    (ignoredField === "proveedor" ||
      filters.proveedor === "todos" ||
      record.proveedor === filters.proveedor) &&
    (ignoredField === "query" ||
      !normalizedQuery ||
      haystack.includes(normalizedQuery)) &&
    (ignoredField === "from" ||
      !filters.from ||
      (recordDate && recordDate >= filters.from)) &&
    (ignoredField === "to" ||
      !filters.to ||
      (recordDate && recordDate <= filters.to))
  );
}

function roundChartMax(value: number) {
  if (value <= 0) {
    return 1;
  }

  if (value <= 10_000) {
    return Math.ceil(value / 500) * 500;
  }

  if (value <= 50_000) {
    return Math.ceil(value / 2_500) * 2_500;
  }

  if (value <= 100_000) {
    return Math.ceil(value / 5_000) * 5_000;
  }

  return Math.ceil(value / 10_000) * 10_000;
}

function getChartTicks(maxValue: number) {
  return [1, 0.75, 0.5, 0.25, 0].map((ratio) => ({
    ratio,
    value: Math.round(maxValue * ratio),
  }));
}

function getRealCartaPorte(record: RegistroOperacion | null | undefined) {
  if (
    !record?.numeroCartaPorte ||
    isGeneratedCartaPorte(record.numeroCartaPorte)
  ) {
    return "";
  }

  return record.numeroCartaPorte;
}

function getRecordFieldValue(
  record: RegistroOperacion,
  field: RelationalFieldKey,
) {
  return (record[field] ?? "").trim();
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

    return normalize(getRecordFieldValue(record, field)).includes(
      normalize(currentValue),
    );
  });
}

function matchEnvaseOption(
  envases: EnvaseOption[],
  detail: RegistroOperacion["detalleEnvases"][number],
) {
  return (
    envases.find((envase) => envase.id === detail.envaseTipoId) ??
    envases.find(
      (envase) =>
        normalize(envase.nombre) === normalize(detail.envaseTipoNombre),
    ) ??
    envases.find(
      (envase) =>
        normalize(envase.codigo) === normalize(detail.envaseTipoCodigo ?? ""),
    ) ??
    null
  );
}

function resolveHistoricalEnvaseTypeId(
  detail: RegistroOperacion["detalleEnvases"][number],
  matchedEnvase: EnvaseOption | null,
) {
  if (matchedEnvase?.id) {
    return matchedEnvase.id;
  }

  const envaseTipoId = compactarEspacios(detail.envaseTipoId ?? "");

  if (
    envaseTipoId &&
    envaseTipoId !== "legacy-packaging" &&
    envaseTipoId !== SIN_ENVASE_TIPO_ID
  ) {
    return envaseTipoId;
  }

  const fallbackLabel =
    compactarEspacios(detail.envaseTipoNombre ?? "") ||
    compactarEspacios(detail.envaseTipoCodigo ?? "") ||
    envaseTipoId;

  return fallbackLabel ? construirEnvaseTipoIdManual(fallbackLabel) : "";
}

function hasIncompleteHistoricalEnvaseDetail(
  detail: RegistroOperacion["detalleEnvases"][number],
) {
  const hasEnvaseLabel =
    compactarEspacios(detail.envaseTipoNombre ?? "") ||
    compactarEspacios(detail.envaseTipoCodigo ?? "") ||
    compactarEspacios(detail.envaseTipoId ?? "");
  const envaseEstado = compactarEspacios(detail.envaseEstado ?? "");
  const kilos = Number(detail.kilos ?? 0);
  const cantidad = Number(detail.cantidad ?? 0);

  return (
    !hasEnvaseLabel ||
    !envaseEstado ||
    !Number.isFinite(kilos) ||
    kilos < 0 ||
    !Number.isFinite(cantidad) ||
    cantidad <= 0
  );
}

function buildIngresoFormSeed(
  record: RegistroOperacion | null,
  envases: EnvaseOption[],
  todayValue: string,
): IngresoFormSeed {
  if (!record) {
    return {
      values: {
        tipoOperacion: "ingreso",
        fechaOperacion: todayValue,
        numeroCartaPorte: buildGeneratedCartaPorte(),
        cliente: "",
        proveedor: "",
        procedencia: "",
        destinatario: "",
        proceso: "",
        producto: "",
        kilos: 0,
        cantidadEnvases: 0,
        envaseTipoId: SIN_ENVASE_TIPO_ID,
        envaseEstado: SIN_ENVASE_ESTADO,
        envaseMode: "granel",
        detalleEnvases: [],
        loteEnvasadoDetalles: [],
        observaciones: "",
      },
      hasCartaPorte: false,
      hasEnvases: false,
      envasesNoMapeados: 0,
    };
  }

  const mappedDetails = record.detalleEnvases.flatMap((detail) => {
    if (isGranelPlaceholderDetail(detail)) {
      return [];
    }

    const matchedEnvase = matchEnvaseOption(envases, detail);
    const resolvedEnvaseTipoId = resolveHistoricalEnvaseTypeId(
      detail,
      matchedEnvase,
    );
    const fallbackName =
      compactarEspacios(detail.envaseTipoNombre ?? "") ||
      compactarEspacios(detail.envaseTipoCodigo ?? "") ||
      resolvedEnvaseTipoId;

    return [
      {
        inventoryId:
          compactarEspacios(detail.inventoryId ?? "") ||
          construirEnvaseInventoryId(
            resolvedEnvaseTipoId || detail.envaseTipoId,
            detail.envaseEstado,
            Number(detail.kilos ?? 0),
          ),
        envaseTipoId: resolvedEnvaseTipoId,
        envaseTipoNombre: fallbackName,
        envaseEstado: detail.envaseEstado,
        kilos: detail.kilos,
        cantidad: detail.cantidad,
      },
    ];
  });
  const envasesNoMapeados = Math.max(
    0,
    record.detalleEnvases.filter(
      (detail) =>
        !isGranelPlaceholderDetail(detail) &&
        hasIncompleteHistoricalEnvaseDetail(detail),
    ).length,
  );
  const numeroCartaPorte = getRealCartaPorte(record);

  return {
    values: {
      tipoOperacion: "ingreso",
      fechaOperacion: formatDateKey(record.fechaOperacion) || todayValue,
      numeroCartaPorte: numeroCartaPorte || buildGeneratedCartaPorte(),
      cliente: record.cliente,
      proveedor: record.proveedor,
      procedencia: record.procedencia,
      destinatario: "",
      proceso: record.proceso,
      producto: record.producto ?? "",
      kilos: record.kilos,
      cantidadEnvases: mappedDetails.reduce(
        (total, detail) => total + Number(detail.cantidad ?? 0),
        0,
      ),
      envaseTipoId: mappedDetails[0]?.envaseTipoId ?? SIN_ENVASE_TIPO_ID,
      envaseEstado: mappedDetails[0]?.envaseEstado ?? SIN_ENVASE_ESTADO,
      envaseMode: mappedDetails.length > 0 ? "manual" : "granel",
      detalleEnvases: mappedDetails,
      loteEnvasadoDetalles: [],
      observaciones: record.observaciones ?? "",
    },
    hasCartaPorte: Boolean(numeroCartaPorte),
    hasEnvases: mappedDetails.length > 0 || record.cantidadEnvases > 0,
    envasesNoMapeados,
  };
}

function cycleSegmentMode(currentValue: SegmentMode, direction: 1 | -1) {
  const currentIndex = SEGMENT_ORDER.indexOf(currentValue);
  const nextIndex =
    (currentIndex + direction + SEGMENT_ORDER.length) % SEGMENT_ORDER.length;
  return SEGMENT_ORDER[nextIndex];
}

function IconBase({
  children,
  className = "h-4 w-4",
  viewBox = "0 0 24 24",
}: {
  children: ReactNode;
  className?: string;
  viewBox?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox={viewBox}
    >
      {children}
    </svg>
  );
}

function IconSearch() {
  return (
    <IconBase>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </IconBase>
  );
}

function IconChevronLeft() {
  return (
    <IconBase>
      <path d="m15 18-6-6 6-6" />
    </IconBase>
  );
}

function IconChevronRight() {
  return (
    <IconBase>
      <path d="m9 18 6-6-6-6" />
    </IconBase>
  );
}

function IconEye() {
  return (
    <IconBase>
      <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" />
      <circle cx="12" cy="12" r="2.8" />
    </IconBase>
  );
}

function IconPencil() {
  return (
    <IconBase>
      <path d="M12 20h9" />
      <path d="m16.5 3.5 4 4L8 20l-4 1 1-4Z" />
    </IconBase>
  );
}

function IconTrash() {
  return (
    <IconBase>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </IconBase>
  );
}

function IconCalendar() {
  return (
    <IconBase>
      <rect height="16" rx="2" width="18" x="3" y="5" />
      <path d="M16 3v4" />
      <path d="M8 3v4" />
      <path d="M3 10h18" />
    </IconBase>
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
    <article className="aether-panel flex min-h-30 flex-col items-center justify-center rounded-2xl px-4 py-5 text-center md:min-h-32">
      <p className="font-display text-[11px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)]">
        {label}
      </p>
      <AutoFitMetricValue
        className="w-full whitespace-nowrap font-display font-bold leading-none tracking-[-0.08em] text-[var(--primary)] md:tracking-[-0.04em]"
        maxSizeRem={3}
        minSizeRem={0.5}
        value={value}
      />
      <p className="mt-2 text-xs font-semibold text-[var(--text-soft)]">
        {helper}
      </p>
    </article>
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
    <label className="grid gap-1 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">
      {label}
      <select
        className="aether-field h-10 min-w-0 py-2 text-sm"
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
    </label>
  );
}

function IconOnlyButton({
  active = false,
  danger = false,
  disabled = false,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
}) {
  const toneClass = danger
    ? "text-[var(--error)] hover:bg-[var(--danger-bg)] hover:text-[var(--error)]"
    : active
      ? "bg-[var(--nav-active-bg)] text-[var(--primary)]"
      : "text-[var(--text-muted)] hover:bg-[var(--nav-hover-bg)] hover:text-[var(--text)]";

  return (
    <button
      className={`grid h-9 w-9 place-items-center rounded-xl transition ${toneClass} disabled:cursor-not-allowed disabled:opacity-45`}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}

function SegmentTelemetry({
  records,
  segmentMode,
  onNext,
  onPrev,
}: {
  records: RegistroOperacion[];
  segmentMode: SegmentMode;
  onNext: () => void;
  onPrev: () => void;
}) {
  const [segmentPage, setSegmentPage] = useState(0);
  const segmentTheme = SEGMENT_THEME[segmentMode];
  const segmentLabel =
    segmentMode === "proceso"
      ? "TN Neto por Proceso"
      : segmentMode === "cliente"
        ? "TN Neto por Cliente"
        : "TN Neto por Producto";
  const segmentData = useMemo(() => {
    const totals = new Map<string, number>();

    for (const record of records) {
      const key =
        segmentMode === "proceso"
          ? record.proceso
          : segmentMode === "cliente"
            ? record.cliente
            : (record.producto ?? "Sin producto");

      if (!key) {
        continue;
      }

      totals.set(key, (totals.get(key) ?? 0) + record.kilos);
    }

    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [records, segmentMode]);
  const totalPages = Math.max(
    1,
    Math.ceil(segmentData.length / SEGMENTOS_POR_PAGINA),
  );
  const visibleSegmentData = segmentData.slice(
    segmentPage * SEGMENTOS_POR_PAGINA,
    (segmentPage + 1) * SEGMENTOS_POR_PAGINA,
  );
  const maxValue = Math.max(1, ...segmentData.map(([, value]) => value));

  useEffect(() => {
    setSegmentPage(0);
  }, [segmentMode]);

  useEffect(() => {
    if (segmentPage > totalPages - 1) {
      setSegmentPage(totalPages - 1);
    }
  }, [segmentPage, totalPages]);

  return (
    <article className="aether-panel rounded-2xl p-5 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-display text-base font-bold text-[var(--text)]">
            TN netos
          </p>
        </div>
        <div
          className="flex items-center gap-2 rounded-full px-2 py-1 ring-1 ring-[var(--line)]"
          style={{ backgroundColor: segmentTheme.pillBg }}
        >
          <IconOnlyButton onClick={onPrev} title="Segmentacion anterior">
            <IconChevronLeft />
          </IconOnlyButton>
          <span
            className="min-w-36 text-center text-xs font-black uppercase tracking-[0.18em]"
            style={{ color: segmentTheme.pillText }}
          >
            {segmentLabel}
          </span>
          <IconOnlyButton onClick={onNext} title="Segmentacion siguiente">
            <IconChevronRight />
          </IconOnlyButton>
        </div>
      </div>

      {segmentData.length > 0 ? (
        <div className="mt-6 grid gap-5">
          {visibleSegmentData.map(([label, value]) => (
            <div className="grid gap-2" key={label}>
              <div className="flex items-center justify-between gap-4 text-sm font-semibold text-[var(--text-soft)]">
                <span className="truncate text-[var(--text)]">{label}</span>
                <span
                  className="shrink-0 font-display text-base font-bold"
                  style={{ color: segmentTheme.accent }}
                >
                  {formatToneladasFromKg(value)}
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-[var(--surface-high)] ring-1 ring-[var(--line)]">
                <div
                  className="h-full rounded-full"
                  style={{
                    background: `linear-gradient(90deg, ${segmentTheme.accent} 0%, ${segmentTheme.accentSoft} 100%)`,
                    boxShadow: `0 0 18px ${segmentTheme.glow}`,
                    width: `${Math.max(8, (value / maxValue) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}

          {totalPages > 1 ? (
            <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
              <span className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                Pagina {segmentPage + 1} de {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <IconOnlyButton
                  disabled={segmentPage === 0}
                  onClick={() =>
                    setSegmentPage((currentValue) =>
                      Math.max(0, currentValue - 1),
                    )
                  }
                  title="Pagina anterior"
                >
                  <IconChevronLeft />
                </IconOnlyButton>
                <IconOnlyButton
                  disabled={segmentPage >= totalPages - 1}
                  onClick={() =>
                    setSegmentPage((currentValue) =>
                      Math.min(totalPages - 1, currentValue + 1),
                    )
                  }
                  title="Pagina siguiente"
                >
                  <IconChevronRight />
                </IconOnlyButton>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="empty-state mt-6 grid min-h-60 place-items-center rounded-2xl px-6 text-center text-sm font-semibold text-[var(--text-muted)]">
          No hay kilos vinculados para la segmentacion seleccionada.
        </div>
      )}
    </article>
  );
}

function DateTelemetry({ records }: { records: RegistroOperacion[] }) {
  const [chartMode, setChartMode] = useState<DateChartMode>("month");
  const [selectedMonthKey, setSelectedMonthKey] = useState("");
  const [selectedYearKey, setSelectedYearKey] = useState("");
  const [hoveredPointId, setHoveredPointId] = useState<string | null>(null);
  const [pinnedPointId, setPinnedPointId] = useState<string | null>(null);

  const availableMonthKeys = useMemo(
    () =>
      [
        ...new Set(
          records
            .map((record) => formatMonthKey(record.fechaOperacion))
            .filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [records],
  );
  const availableYearKeys = useMemo(
    () =>
      [
        ...new Set(
          records
            .map((record) => formatDateKey(record.fechaOperacion).slice(0, 4))
            .filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [records],
  );

  useEffect(() => {
    if (!selectedMonthKey || !availableMonthKeys.includes(selectedMonthKey)) {
      setSelectedMonthKey(availableMonthKeys.at(-1) ?? "");
    }
  }, [availableMonthKeys, selectedMonthKey]);

  useEffect(() => {
    if (!selectedYearKey || !availableYearKeys.includes(selectedYearKey)) {
      setSelectedYearKey(availableYearKeys.at(-1) ?? "");
    }
  }, [availableYearKeys, selectedYearKey]);

  const chartPoints = useMemo(() => {
    if (records.length === 0) {
      return [] as DateChartPoint[];
    }

    if (chartMode === "month") {
      const totals = new Map<string, DateChartPoint>();

      for (const record of records) {
        if (formatMonthKey(record.fechaOperacion) !== selectedMonthKey) {
          continue;
        }

        const dateKey = formatDateKey(record.fechaOperacion);

        if (!dateKey) {
          continue;
        }

        const currentValue = totals.get(dateKey) ?? {
          id: dateKey,
          axisLabel: formatChartDay(record.fechaOperacion),
          kilos: 0,
          entries: [],
          summaryLabel: formatDisplayDate(record.fechaOperacion),
          xRatio:
            Math.max(
              Number((dateKey.split("-")[2] ?? "1").replace(/^0/, "")) - 1,
              0,
            ) / Math.max(getDaysInMonth(selectedMonthKey) - 1, 1),
        };

        currentValue.kilos += record.kilos;
        currentValue.entries.push({
          id: record.id,
          label: `Ingreso ${currentValue.entries.length + 1}`,
          subtitle: `${record.cliente} - ${record.proceso}`,
          kilos: record.kilos,
        });
        totals.set(dateKey, currentValue);
      }

      return [...totals.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([, value]) => value);
    }

    const totals = new Map<string, DateChartPoint>();

    for (const record of records) {
      const yearKey = formatDateKey(record.fechaOperacion).slice(0, 4);

      if (!yearKey || yearKey !== selectedYearKey) {
        continue;
      }

      const monthKey = formatMonthKey(record.fechaOperacion);

      if (!monthKey) {
        continue;
      }

      const currentValue = totals.get(monthKey) ?? {
        id: monthKey,
        axisLabel: formatMonthShort(monthKey),
        kilos: 0,
        entries: [],
        summaryLabel: formatMonthLabel(monthKey),
        xRatio:
          Math.max(
            Number((monthKey.split("-")[1] ?? "1").replace(/^0/, "")) - 1,
            0,
          ) / 11,
      };

      currentValue.kilos += record.kilos;
      currentValue.entries.push({
        id: record.id,
        label: formatDisplayDate(record.fechaOperacion),
        subtitle: `${record.cliente} - ${record.proceso}`,
        kilos: record.kilos,
      });
      totals.set(monthKey, currentValue);
    }

    return [...totals.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, value]) => value);
  }, [chartMode, records, selectedMonthKey, selectedYearKey]);

  const maxValue = roundChartMax(
    Math.max(1, ...chartPoints.map((point) => point.kilos)),
  );
  const activePointId = pinnedPointId ?? hoveredPointId;
  const activePoint =
    chartPoints.find((point) => point.id === activePointId) ?? null;
  const chartTicks = getChartTicks(maxValue);
  const selectedMonthDays = getDaysInMonth(selectedMonthKey);
  const dayAxisMarkers = [
    ...new Set([1, 5, 10, 15, 20, 25, selectedMonthDays]),
  ];
  const selectedPeriodLabel =
    chartMode === "month"
      ? formatMonthLabel(selectedMonthKey)
      : selectedYearKey || "Sin año";

  useEffect(() => {
    if (
      activePointId &&
      !chartPoints.some((point) => point.id === activePointId)
    ) {
      setHoveredPointId(null);
      setPinnedPointId(null);
    }
  }, [activePointId, chartPoints]);

  function movePeriod(direction: -1 | 1) {
    const source =
      chartMode === "month" ? availableMonthKeys : availableYearKeys;
    const selectedValue =
      chartMode === "month" ? selectedMonthKey : selectedYearKey;
    const currentIndex = source.indexOf(selectedValue);

    if (currentIndex < 0) {
      return;
    }

    const nextValue = source[currentIndex + direction];

    if (!nextValue) {
      return;
    }

    if (chartMode === "month") {
      setSelectedMonthKey(nextValue);
      return;
    }

    setSelectedYearKey(nextValue);
  }

  return (
    <article className="aether-panel rounded-2xl p-5 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="font-display text-base font-bold text-[var(--text)]">
            Ingresos por fecha
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Navegue por mes o por año. Toca en un punto para ver los kilos y
            detallar cada ingreso.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-full bg-[var(--surface-low)] p-1 ring-1 ring-[var(--line)]">
            <button
              className={`rounded-full px-3 py-2 text-xs font-bold transition ${
                chartMode === "month"
                  ? "bg-[var(--nav-active-bg)] text-[var(--primary)]"
                  : "text-[var(--text-muted)]"
              }`}
              onClick={() => setChartMode("month")}
              type="button"
            >
              Mes
            </button>
            <button
              className={`rounded-full px-3 py-2 text-xs font-bold transition ${
                chartMode === "year"
                  ? "bg-[var(--nav-active-bg)] text-[var(--primary)]"
                  : "text-[var(--text-muted)]"
              }`}
              onClick={() => setChartMode("year")}
              type="button"
            >
              Año
            </button>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-[var(--surface-low)] px-2 py-1 ring-1 ring-[var(--line)]">
            <IconOnlyButton
              disabled={
                (chartMode === "month"
                  ? availableMonthKeys
                  : availableYearKeys
                ).indexOf(
                  chartMode === "month" ? selectedMonthKey : selectedYearKey,
                ) <= 0
              }
              onClick={() => movePeriod(-1)}
              title="Periodo anterior"
            >
              <IconChevronLeft />
            </IconOnlyButton>
            <span className="min-w-28 text-center text-xs font-black uppercase tracking-[0.16em] text-[var(--text-soft)]">
              {selectedPeriodLabel}
            </span>
            <IconOnlyButton
              disabled={
                (chartMode === "month"
                  ? availableMonthKeys
                  : availableYearKeys
                ).indexOf(
                  chartMode === "month" ? selectedMonthKey : selectedYearKey,
                ) ===
                (chartMode === "month" ? availableMonthKeys : availableYearKeys)
                  .length -
                  1
              }
              onClick={() => movePeriod(1)}
              title="Periodo siguiente"
            >
              <IconChevronRight />
            </IconOnlyButton>
          </div>
        </div>
      </div>

      {chartPoints.length > 0 ? (
        <div className="mt-6 grid grid-cols-[56px_minmax(0,1fr)] gap-4">
          <div className="relative h-[19rem]">
            {chartTicks.map((tick) => (
              <span
                className="absolute right-0 translate-y-1/2 text-[10px] font-bold text-[var(--text-muted)]"
                key={tick.ratio}
                style={{ bottom: `${tick.ratio * 100}%` }}
              >
                {formatNumber(tick.value, 0)}
              </span>
            ))}
          </div>
          <div className="relative h-[19rem] overflow-hidden rounded-2xl bg-[var(--surface-low)]/55 px-4 pb-11 pt-4 ring-1 ring-[var(--line)]">
            <div className="absolute inset-x-4 bottom-10 top-4">
              {chartTicks.map((tick) => (
                <span
                  className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[var(--line)]"
                  key={tick.ratio}
                  style={{ bottom: `${tick.ratio * 100}%` }}
                />
              ))}

              {chartPoints.map((point) => {
                const xPercent = point.xRatio * 100;
                const heightPercent = Math.max(
                  6,
                  (point.kilos / maxValue) * 100,
                );
                const isActive = activePoint?.id === point.id;

                return (
                  <div
                    className="absolute bottom-0 top-0"
                    key={point.id}
                    style={{ left: `${xPercent}%` }}
                  >
                    <button
                      className="relative block h-full w-5 -translate-x-1/2 outline-none"
                      onClick={() =>
                        setPinnedPointId((currentValue) =>
                          currentValue === point.id ? null : point.id,
                        )
                      }
                      onMouseEnter={() => setHoveredPointId(point.id)}
                      onMouseLeave={() => setHoveredPointId(null)}
                      type="button"
                    >
                      <span
                        className="absolute bottom-0 left-1/2 w-px -translate-x-1/2 bg-[var(--line-strong)]"
                        style={{ height: `${heightPercent}%` }}
                      />
                      <span
                        className={`absolute left-1/2 h-4 w-4 -translate-x-1/2 rounded-full border-2 ${
                          isActive
                            ? "border-[var(--warning)] bg-[var(--primary)] shadow-[0_0_24px_rgba(111,209,255,0.55)]"
                            : "border-[var(--surface)] bg-[var(--primary)] shadow-[0_0_16px_rgba(111,209,255,0.32)]"
                        }`}
                        style={{ bottom: `calc(${heightPercent}% - 0.5rem)` }}
                      />
                    </button>
                    <span className="absolute left-1/2 top-[calc(100%-0.05rem)] hidden w-14 -translate-x-1/2 text-center text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--text-muted)] min-[1020px]:block">
                      {point.axisLabel}
                    </span>
                  </div>
                );
              })}
            </div>

            <span className="pointer-events-none absolute inset-x-4 bottom-10 border-t border-[var(--line)]" />
            {chartMode === "month" && selectedMonthKey ? (
              <div className="pointer-events-none absolute inset-x-4 bottom-3">
                {dayAxisMarkers.map((day) => (
                  <span
                    className="absolute hidden w-8 -translate-x-1/2 text-center text-[10px] font-bold text-[var(--text-muted)] min-[1020px]:block"
                    key={`day-${day}`}
                    style={{
                      left: `${((day - 1) / Math.max(selectedMonthDays - 1, 1)) * 100}%`,
                    }}
                  >
                    {day}
                  </span>
                ))}
              </div>
            ) : null}

            {activePoint ? (
              <div className="absolute right-4 top-4 z-10 w-72 max-w-[calc(100%-2rem)] rounded-2xl bg-[var(--surface)]/96 px-4 py-4 text-left shadow-[0_22px_48px_rgba(2,6,23,0.22)] ring-1 ring-[var(--line)] backdrop-blur">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-display text-sm font-bold text-[var(--text)]">
                      {activePoint.summaryLabel}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-[var(--primary)]">
                      Total: {formatKilos(activePoint.kilos)}
                    </p>
                  </div>
                  <button
                    className="text-xs font-black uppercase tracking-[0.16em] text-[var(--text-muted)]"
                    onClick={() => setPinnedPointId(null)}
                    type="button"
                  >
                    Cerrar
                  </button>
                </div>
                <div className="mt-3 grid max-h-52 gap-2 overflow-y-auto">
                  {activePoint.entries.map((entry) => (
                    <div
                      className="rounded-xl bg-[var(--surface-low)] px-3 py-3 text-sm ring-1 ring-[var(--line)]"
                      key={entry.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-[var(--text)]">
                            {entry.label}
                          </p>
                          <p className="mt-1 text-xs text-[var(--text-muted)]">
                            {entry.subtitle}
                          </p>
                        </div>
                        <span className="shrink-0 font-display text-sm font-bold text-[var(--primary)]">
                          {formatKilos(entry.kilos)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="empty-state mt-6 grid min-h-72 place-items-center rounded-2xl px-6 text-center text-sm font-semibold text-[var(--text-muted)]">
          No hay ingresos para el periodo y filtros activos.
        </div>
      )}
    </article>
  );
}

function HistorialCard({
  expanded,
  isDeleting,
  onDelete,
  onEdit,
  onToggle,
  record,
}: {
  expanded: boolean;
  isDeleting: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onToggle: () => void;
  record: RegistroOperacion;
}) {
  const cartaPorteLabel = getRealCartaPorte(record) || "-";
  /*
      ? record.detalleEnvases
          .map(
            (detail) =>
              `${detail.envaseTipoNombre || SIN_ENVASE_NOMBRE} | ${detail.envaseEstado} | ${formatKilos(detail.kilos)} | ${formatNumber(detail.cantidad, 0)}`
          )
          .join(" • ")
      : "Sin envases";
  */
  return (
    <article className="aether-panel-soft rounded-2xl px-4 py-4 md:px-5">
      <div className="flex gap-4">
        <button
          className="flex-1 rounded-2xl text-left transition hover:bg-[var(--surface-high)]/28"
          onClick={onToggle}
          type="button"
        >
          <div className="grid gap-3 pr-2 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.5fr)_120px_150px] md:items-center">
            <p className="truncate font-display text-base font-bold text-[var(--text)]">
              {record.producto ?? "Sin producto"}
            </p>
            <p className="truncate text-sm font-semibold text-[var(--text-soft)]">
              ({record.cliente} - {record.proceso})
            </p>
            <p className="text-sm font-semibold text-[var(--text-muted)] md:text-center">
              {formatDisplayDate(record.fechaOperacion)}
            </p>
            <p className="font-display text-lg font-bold text-[var(--primary)] md:text-right">
              {formatKilos(record.kilos)}
            </p>
          </div>
        </button>

        <div className="flex shrink-0 items-start gap-1">
          <IconOnlyButton
            active={expanded}
            onClick={onToggle}
            title="Ver detalle"
          >
            <IconEye />
          </IconOnlyButton>
          <IconOnlyButton
            disabled={isDeleting}
            onClick={onEdit}
            title="Editar ingreso"
          >
            <IconPencil />
          </IconOnlyButton>
          <IconOnlyButton
            danger
            disabled={isDeleting}
            onClick={onDelete}
            title="Eliminar ingreso"
          >
            <IconTrash />
          </IconOnlyButton>
        </div>
      </div>

      {expanded ? (
        <div className="mt-4 grid gap-4 border-t border-[var(--line)] pt-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl bg-[var(--surface-low)] px-4 py-3 text-sm text-[var(--text-soft)] ring-1 ring-[var(--line)]">
              <p>
                <span className="font-bold text-[var(--text)]">Proveedor:</span>{" "}
                {record.proveedor}
              </p>
              <p className="mt-2">
                <span className="font-bold text-[var(--text)]">
                  Carta de porte:
                </span>{" "}
                {cartaPorteLabel}
              </p>
            </div>
            <div className="rounded-xl bg-[var(--surface-low)] px-4 py-3 ring-1 ring-[var(--line)]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[var(--text-muted)]">
                  Envases
                </p>
                <span className="rounded-full bg-[var(--surface-high)] px-3 py-1.5 text-[11px] font-bold text-[var(--text-soft)] ring-1 ring-[var(--line)]">
                  {record.detalleEnvases.length > 0
                    ? `${record.cantidadEnvases} unidades`
                    : "Sin envases"}
                </span>
              </div>
              {record.detalleEnvases.length > 0 ? (
                <div className="mt-3 grid gap-2">
                  {record.detalleEnvases.map((detail, index) => (
                    <div
                      className="grid grid-cols-2 gap-3 rounded-xl bg-[var(--surface)]/70 px-3 py-3 text-sm text-[var(--text-soft)] ring-1 ring-[var(--line)] min-[1000px]:grid-cols-[minmax(0,1.2fr)_minmax(0,0.95fr)_110px_110px] min-[1000px]:items-center"
                      key={`${record.id}-${detail.envaseTipoId}-${index}`}
                    >
                      <div className="grid gap-1">
                        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)] min-[1000px]:hidden">
                          Envase
                        </span>
                        <span className="font-semibold text-[var(--text)]">
                          {detail.envaseTipoNombre || SIN_ENVASE_NOMBRE}
                        </span>
                      </div>
                      <div className="grid gap-1">
                        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)] min-[1000px]:hidden">
                          Estado
                        </span>
                        <span>{detail.envaseEstado}</span>
                      </div>
                      <div className="grid gap-1 min-[1000px]:text-center">
                        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)] min-[1000px]:hidden">
                          Kg
                        </span>
                        <span>{formatKilos(detail.kilos)}</span>
                      </div>
                      <div className="grid gap-1 min-[1000px]:text-right">
                        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)] min-[1000px]:hidden">
                          Cantidad
                        </span>
                        <span className="font-bold text-[var(--primary)]">
                          {formatNumber(detail.cantidad, 0)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-[var(--text-muted)]">
                  Este ingreso no tiene envases asociados.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-xl bg-[var(--surface-low)] px-4 py-3 text-sm text-[var(--text-soft)] ring-1 ring-[var(--line)]">
            <p>
              <span className="font-bold text-[var(--text)]">
                Observaciones:
              </span>{" "}
              {record.observaciones ?? "Sin observaciones"}
            </p>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function PaginationControls({
  currentPage,
  onPageChange,
  totalPages,
}: {
  currentPage: number;
  onPageChange: (nextPage: number) => void;
  totalPages: number;
}) {
  if (totalPages <= 1) {
    return null;
  }

  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, startPage + 4);
  const visiblePages = [];

  for (let page = startPage; page <= endPage; page += 1) {
    visiblePages.push(page);
  }

  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
      <p className="text-xs font-semibold text-[var(--text-muted)]">
        Pagina {currentPage} de {totalPages}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="console-secondary-button rounded-xl px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-45"
          disabled={currentPage === 1}
          onClick={() => onPageChange(currentPage - 1)}
          type="button"
        >
          Anterior
        </button>
        {visiblePages.map((page) => (
          <button
            className={`rounded-xl px-3 py-2 text-xs font-bold transition ${
              currentPage === page
                ? "bg-[var(--nav-active-bg)] text-[var(--primary)] ring-1 ring-[var(--line-strong)]"
                : "bg-[var(--surface-low)] text-[var(--text-soft)] ring-1 ring-[var(--line)] hover:text-[var(--text)]"
            }`}
            key={page}
            onClick={() => onPageChange(page)}
            type="button"
          >
            {page}
          </button>
        ))}
        <button
          className="console-secondary-button rounded-xl px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-45"
          disabled={currentPage === totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          type="button"
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}

export function DescargasConsole({
  registros,
  envases,
  deepLinkIntent,
  deepLinkRecordId,
  deepLinkSource,
  firestoreDisponible,
  isLoading = false,
  loadError = null,
  storageConfigurado,
}: DescargasConsoleProps) {
  const router = useRouter();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<RegistroOperacion | null>(
    null,
  );
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [segmentMode, setSegmentMode] = useState<SegmentMode>("proceso");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    null,
  );
  const [actionPendingId, setActionPendingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const handledDeepLinkRef = useRef<string | null>(null);
  const { campaigns } = useCampaignPeriods();
  const defaultCampaignId = useMemo(
    () => getDefaultCampaignId(campaigns),
    [campaigns],
  );
  const resolvedSelectedCampaignId =
    selectedCampaignId ?? defaultCampaignId ?? "all";
  const [filters, setFilters] = useState<DescargasFilters>({
    query: "",
    from: "",
    to: "",
    cliente: "todos",
    proceso: "todos",
    producto: "todos",
    proveedor: "todos",
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
  const clienteOptions = useMemo(
    () =>
      uniqueValues(
        sortedRecords
          .filter((record) =>
            matchesDescargaFilters(record, scopedFilters, "cliente"),
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
            matchesDescargaFilters(record, scopedFilters, "proceso"),
          )
          .map((record) => record.proceso),
      ),
    [scopedFilters, sortedRecords],
  );
  const productoOptions = useMemo(
    () =>
      uniqueValues(
        sortedRecords
          .filter((record) =>
            matchesDescargaFilters(record, scopedFilters, "producto"),
          )
          .map((record) => record.producto ?? "Sin producto"),
      ),
    [scopedFilters, sortedRecords],
  );
  const proveedorOptions = useMemo(
    () =>
      uniqueValues(
        sortedRecords
          .filter((record) =>
            matchesDescargaFilters(record, scopedFilters, "proveedor"),
          )
          .map((record) => record.proveedor),
      ),
    [scopedFilters, sortedRecords],
  );
  const searchSuggestions = useMemo(
    () =>
      uniqueValues(
        sortedRecords.flatMap((record) => [
          record.cliente,
          record.producto ?? "Sin producto",
          record.proceso,
          record.proveedor,
          record.numeroCartaPorte,
        ]),
      ),
    [sortedRecords],
  );
  const filteredRecords = useMemo(
    () =>
      sortedRecords.filter((record) =>
        matchesDescargaFilters(record, scopedFilters),
      ),
    [scopedFilters, sortedRecords],
  );
  const availableClientes = useMemo(
    () => ["todos", ...clienteOptions],
    [clienteOptions],
  );
  const kilosFiltrados = useMemo(
    () => filteredRecords.reduce((total, record) => total + record.kilos, 0),
    [filteredRecords],
  );
  const totalPages = Math.max(
    1,
    Math.ceil(filteredRecords.length / REGISTROS_POR_PAGINA),
  );
  const visibleRecords = useMemo(
    () =>
      filteredRecords.slice(
        (currentPage - 1) * REGISTROS_POR_PAGINA,
        currentPage * REGISTROS_POR_PAGINA,
      ),
    [currentPage, filteredRecords],
  );
  const deepLinkKey =
    deepLinkSource && deepLinkIntent && deepLinkRecordId
      ? `${deepLinkSource}:${deepLinkIntent}:${deepLinkRecordId}`
      : "";

  function clearDeepLink() {
    router.replace("/modulos?tab=descargas", { scroll: false });
  }

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
      filters.producto !== "todos" &&
      !productoOptions.includes(filters.producto)
    ) {
      setFilters((currentValue) => ({ ...currentValue, producto: "todos" }));
    }
  }, [filters.producto, productoOptions]);

  useEffect(() => {
    if (
      filters.proveedor !== "todos" &&
      !proveedorOptions.includes(filters.proveedor)
    ) {
      setFilters((currentValue) => ({ ...currentValue, proveedor: "todos" }));
    }
  }, [filters.proveedor, proveedorOptions]);

  useEffect(() => {
    setCurrentPage(1);
    setExpandedRecordId(null);
  }, [filters, resolvedSelectedCampaignId]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const currentClienteIndex = Math.max(
    0,
    availableClientes.indexOf(filters.cliente),
  );
  const currentClienteLabel =
    filters.cliente === "todos"
      ? "Todos los clientes"
      : (availableClientes[currentClienteIndex] ?? "Sin clientes");

  function cycleCliente(direction: -1 | 1) {
    if (availableClientes.length === 0) {
      return;
    }

    const nextIndex =
      (currentClienteIndex + direction + availableClientes.length) %
      availableClientes.length;

    setFilters((currentValue) => ({
      ...currentValue,
      cliente: availableClientes[nextIndex] ?? "todos",
    }));
  }

  async function handleDelete(
    record: RegistroOperacion,
    options?: { clearDeepLink?: boolean },
  ) {
    const confirmed = window.confirm(
      `Va a eliminar la descarga ${record.producto ?? "sin producto"} del ${formatDisplayDate(record.fechaOperacion)}.`,
    );

    if (!confirmed) {
      if (options?.clearDeepLink) {
        clearDeepLink();
      }

      return;
    }

    setActionPendingId(record.id);
    setFeedback(null);

    try {
      const response = await fetchWithFirebaseAuth("/api/descargas", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          operacionId: record.id,
        }),
      });
      const result =
        (await response.json()) as ActionState<OperacionMutationData>;

      if (!result.ok) {
        setFeedback({
          tone: "error",
          message: result.message,
        });
        return;
      }

      if (expandedRecordId === record.id) {
        setExpandedRecordId(null);
      }

      setFeedback({
        tone: "success",
        message: result.message,
      });
      refreshAllModuleData();
    } catch (error) {
      setFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "No fue posible eliminar la descarga.",
      });
    } finally {
      setActionPendingId(null);

      if (options?.clearDeepLink) {
        clearDeepLink();
      }
    }
  }

  useEffect(() => {
    if (!deepLinkKey) {
      handledDeepLinkRef.current = null;
      return;
    }

    if (isLoading || handledDeepLinkRef.current === deepLinkKey) {
      return;
    }

    const record = sortedRecords.find((item) => item.id === deepLinkRecordId);
    handledDeepLinkRef.current = deepLinkKey;

    if (!record) {
      setFeedback({
        tone: "error",
        message: "No se encontro el ingreso solicitado para abrir desde Envases.",
      });
      clearDeepLink();
      return;
    }

    setExpandedRecordId(record.id);

    if (deepLinkIntent === "edit") {
      setEditingRecord(record);
      clearDeepLink();
      return;
    }

    void handleDelete(record, { clearDeepLink: true });
  }, [deepLinkIntent, deepLinkKey, deepLinkRecordId, isLoading, sortedRecords]);

  return (
    <>
      <ConsoleShell
        active="descargas"
        firestoreDisponible={firestoreDisponible}
        footerHint="Descargas unificadas sobre la coleccion legacy, con filtros relacionales, graficos y acciones rapidas."
        footerLabel={
          firestoreDisponible ? "Descargas online" : "Descargas pendientes"
        }
      >
        <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="flex items-center gap-3 font-display text-4xl font-bold text-[var(--text)]">
              <span>Descargas</span>
              <ModuleLoadingIndicator isLoading={isLoading} />
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-soft)]">
              Ingresos y registros desde la base de descargas.
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <ModuleSearchBox
              className="w-full min-w-0 sm:w-80"
              onChange={(event) =>
                setFilters((currentValue) => ({
                  ...currentValue,
                  query: event,
                }))
              }
              placeholder="Buscar cliente, producto, proceso o CP"
              suggestions={searchSuggestions}
              value={filters.query}
            />
            <button
              className="primary-action-button rounded-xl px-5 py-3 text-xs font-black text-[var(--primary-ink)] transition hover:brightness-110"
              onClick={() => setIsCreateModalOpen(true)}
              type="button"
            >
              Agregar ingreso manual
            </button>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(260px,0.42fr)_minmax(0,1.18fr)]">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-1">
            <MetricCard
              helper=""
              label="TN ingresadas"
              value={formatToneladasFromKg(kilosFiltrados)}
            />
            <MetricCard
              helper=""
              label="Cantidad de descargas"
              value={formatNumber(filteredRecords.length, 0)}
            />
          </div>
          <SegmentTelemetry
            onNext={() =>
              setSegmentMode((currentValue) =>
                cycleSegmentMode(currentValue, 1),
              )
            }
            onPrev={() =>
              setSegmentMode((currentValue) =>
                cycleSegmentMode(currentValue, -1),
              )
            }
            records={filteredRecords}
            segmentMode={segmentMode}
          />
        </section>

        <DateTelemetry records={filteredRecords} />

        <ModuleIntegratedFilters
          campaigns={campaigns}
          currentClientLabel={currentClienteLabel}
          filtersClassName="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5"
          isOpen={isFiltersOpen}
          onChangeCampaign={setSelectedCampaignId}
          onClear={() => {
            setSelectedCampaignId("all");
            setFilters({
              query: "",
              from: "",
              to: "",
              cliente: "todos",
              proceso: "todos",
              producto: "todos",
              proveedor: "todos",
            });
          }}
          onNextClient={() => cycleCliente(1)}
          onPrevClient={() => cycleCliente(-1)}
          onToggle={() => setIsFiltersOpen((currentValue) => !currentValue)}
          selectedCampaignId={resolvedSelectedCampaignId}
        >
          <label className="grid gap-1 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">
            Desde
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
          </label>
          <label className="grid gap-1 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">
            Hasta
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
          </label>
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
            label="Proveedor"
            onChange={(value) =>
              setFilters((currentValue) => ({
                ...currentValue,
                proveedor: value,
              }))
            }
            options={proveedorOptions}
            value={filters.proveedor}
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

        <section className="aether-panel rounded-2xl p-4 md:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-display text-base font-bold text-[var(--text)]">
                Historial de ingresos
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
                  isDeleting={actionPendingId === record.id}
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
                No hay descargas para los filtros seleccionados.
              </div>
            )}
          </div>

          <PaginationControls
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            totalPages={totalPages}
          />
        </section>

        {!storageConfigurado ? (
          <div className="aether-panel rounded-2xl p-4 text-sm text-[var(--warning)]">
            Storage no esta configurado. Los ingresos manuales se guardan igual,
            pero sin PDF adjunto.
          </div>
        ) : null}
      </ConsoleShell>

      {isCreateModalOpen ? (
        <IngresoDescargaModal
          envases={envases}
          onClose={() => setIsCreateModalOpen(false)}
          onSuccess={(message) => {
            setFeedback({
              tone: "success",
              message,
            });
            setIsCreateModalOpen(false);
          }}
          records={sortedRecords}
        />
      ) : null}

      {editingRecord ? (
        <IngresoDescargaModal
          envases={envases}
          onClose={() => setEditingRecord(null)}
          onSuccess={(message) => {
            setFeedback({
              tone: "success",
              message,
            });
            setEditingRecord(null);
          }}
          records={sortedRecords}
          recordToEdit={editingRecord}
        />
      ) : null}
    </>
  );
}

function ModalField({
  children,
  error,
  label,
}: {
  children: ReactNode;
  error?: string;
  label: string;
}) {
  return (
    <label className="grid gap-2 text-xs font-bold text-[var(--modal-muted)]">
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

function IngresoDescargaModal({
  envases,
  onClose,
  onSuccess,
  records,
  recordToEdit = null,
}: {
  envases: EnvaseOption[];
  onClose: () => void;
  onSuccess: (message: string) => void;
  records: RegistroOperacion[];
  recordToEdit?: RegistroOperacion | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const todayValue = formatDateKey(new Date());
  const initialSeed = useMemo(
    () => buildIngresoFormSeed(recordToEdit, envases, todayValue),
    [envases, recordToEdit, todayValue],
  );
  const generatedCartaPorteRef = useRef(initialSeed.values.numeroCartaPorte);
  const autoFilledFieldsRef = useRef<Set<RelationalFieldKey>>(new Set());
  const manualFieldsRef = useRef<Set<RelationalFieldKey>>(new Set());
  const [hasCartaPorte, setHasCartaPorte] = useState(initialSeed.hasCartaPorte);
  const [hasEnvases, setHasEnvases] = useState(initialSeed.hasEnvases);
  const form = useForm<OperacionIngresoFormInput>({
    resolver: zodResolver(operacionIngresoFormSchema),
    defaultValues: initialSeed.values,
  });
  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: "detalleEnvases",
  });
  const cliente = form.watch("cliente");
  const producto = form.watch("producto");
  const proveedor = form.watch("proveedor");
  const proceso = form.watch("proceso");
  const detalleEnvases = form.watch("detalleEnvases");
  const isEditMode = Boolean(recordToEdit);
  const relationalValues = useMemo(
    () => ({
      cliente,
      producto: producto ?? "",
      proceso,
      proveedor,
    }),
    [cliente, producto, proceso, proveedor],
  );
  const relationalOptions = useMemo(() => {
    return RELATIONAL_FIELDS.reduce<Record<RelationalFieldKey, string[]>>(
      (accumulator, field) => {
        accumulator[field] = uniqueValues(
          records
            .filter((record) =>
              matchesRelationalFieldSet(record, relationalValues, field),
            )
            .map((record) => getRecordFieldValue(record, field)),
        );
        return accumulator;
      },
      {
        cliente: [],
        producto: [],
        proceso: [],
        proveedor: [],
      },
    );
  }, [records, relationalValues]);

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
    generatedCartaPorteRef.current = initialSeed.values.numeroCartaPorte;
    autoFilledFieldsRef.current = new Set();
    manualFieldsRef.current = new Set();
    setHasCartaPorte(initialSeed.hasCartaPorte);
    setHasEnvases(initialSeed.hasEnvases);
    setServerError(null);
    form.reset(initialSeed.values);
  }, [form, initialSeed]);

  useEffect(() => {
    form.setValue("procedencia", proveedor || "", {
      shouldDirty: false,
      shouldValidate: false,
    });
  }, [form, proveedor]);

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

  useEffect(() => {
    if (hasCartaPorte) {
      form.setValue("numeroCartaPorte", getRealCartaPorte(recordToEdit) || "", {
        shouldDirty: false,
        shouldValidate: false,
      });
      return;
    }

    if (
      !generatedCartaPorteRef.current ||
      !isGeneratedCartaPorte(generatedCartaPorteRef.current)
    ) {
      generatedCartaPorteRef.current = buildGeneratedCartaPorte();
    }

    form.setValue("numeroCartaPorte", generatedCartaPorteRef.current, {
      shouldDirty: false,
      shouldValidate: false,
    });
  }, [form, hasCartaPorte, recordToEdit]);

  useEffect(() => {
    if (!hasEnvases) {
      replace([]);
      form.setValue("cantidadEnvases", 0, { shouldValidate: false });
      form.setValue("envaseTipoId", SIN_ENVASE_TIPO_ID, {
        shouldValidate: false,
      });
      form.setValue("envaseEstado", SIN_ENVASE_ESTADO, {
        shouldValidate: false,
      });
      return;
    }

    if (fields.length === 0) {
      append({ ...DEFAULT_DESCARGA_ENVASE });
    }
  }, [append, envases, fields.length, form, hasEnvases, replace]);

  useEffect(() => {
    if (!hasEnvases) {
      return;
    }

    const totalCantidad = (detalleEnvases ?? []).reduce(
      (total, detail) => total + Number(detail?.cantidad ?? 0),
      0,
    );
    const firstDetail = detalleEnvases?.[0];

    form.setValue("cantidadEnvases", totalCantidad, { shouldValidate: false });
    form.setValue(
      "envaseTipoId",
      firstDetail?.envaseTipoId || envases[0]?.nombre || SIN_ENVASE_TIPO_ID,
      { shouldValidate: false },
    );
    form.setValue("envaseEstado", firstDetail?.envaseEstado || "Conforme", {
      shouldValidate: false,
    });
  }, [detalleEnvases, envases, form, hasEnvases]);

  const handleSubmit = form.handleSubmit((values) => {
    if (!values.producto?.trim()) {
      form.setError("producto", {
        type: "manual",
        message: "El producto es obligatorio.",
      });
      return;
    }

    if (
      hasEnvases &&
      (!values.detalleEnvases || values.detalleEnvases.length === 0)
    ) {
      setServerError(
        "Debe agregar al menos un envase o desactivar esa seccion.",
      );
      return;
    }

    setServerError(null);

    startTransition(async () => {
      try {
        const requestBody = new FormData();
        const detalle = hasEnvases
          ? (values.detalleEnvases ?? [])
          : [
              {
                envaseTipoId: DESCARGA_GRANEL_LABEL,
                envaseEstado: DESCARGA_GRANEL_ESTADO,
                kilos: 0,
                cantidad: 0,
              },
            ];
        const totalCantidad = detalle.reduce(
          (total, item) => total + Number(item.cantidad ?? 0),
          0,
        );
        const firstDetail = detalle[0];

        if (recordToEdit) {
          requestBody.set("operacionId", recordToEdit.id);
        }

        requestBody.set("fechaOperacion", values.fechaOperacion);
        requestBody.set(
          "numeroCartaPorte",
          hasCartaPorte
            ? values.numeroCartaPorte
            : generatedCartaPorteRef.current,
        );
        requestBody.set("cliente", values.cliente);
        requestBody.set("producto", values.producto?.trim() ?? "");
        requestBody.set("proceso", values.proceso);
        requestBody.set("proveedor", values.proveedor);
        requestBody.set("procedencia", values.proveedor);
        requestBody.set("kilos", String(values.kilos));
        requestBody.set("cantidadEnvases", String(totalCantidad));
        requestBody.set(
          "envaseTipoId",
          firstDetail?.envaseTipoId || SIN_ENVASE_TIPO_ID,
        );
        requestBody.set(
          "envaseEstado",
          firstDetail?.envaseEstado || SIN_ENVASE_ESTADO,
        );
        requestBody.set("envaseMode", hasEnvases ? "manual" : "granel");
        requestBody.set("detalleEnvases", JSON.stringify(detalle));
        requestBody.set("loteEnvasadoDetalles", JSON.stringify([]));
        requestBody.set("observaciones", values.observaciones ?? "");

        const response = await fetchWithFirebaseAuth("/api/descargas", {
          method: recordToEdit ? "PATCH" : "POST",
          body: requestBody,
        });
        const result =
          (await response.json()) as ActionState<OperacionMutationData>;

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
            : `No fue posible ${recordToEdit ? "actualizar" : "registrar"} el ingreso.`,
        );
      }
    });
  });

  return (
    <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <section className="modal-shell max-h-[94vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-[var(--modal-surface)] text-[var(--modal-ink)] ring-1 ring-[rgba(226,232,240,0.7)] backdrop-blur-2xl">
        <div className="modal-topbar flex items-start justify-between gap-6 border-b border-[var(--modal-line)] px-8 py-7">
          <div>
            <h2 className="font-display text-3xl font-bold text-[var(--modal-ink)]">
              {isEditMode ? "Editar ingreso" : "Agregar ingreso manual"}
            </h2>
            <p className="mt-2 text-sm text-[var(--modal-muted)]">
              {isEditMode
                ? "Ajuste la descarga seleccionada sin salir del historial."
                : "Registre una descarga manual con carta de porte opcional y varios envases."}
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
            <input type="hidden" {...form.register("tipoOperacion")} />
            <input type="hidden" {...form.register("procedencia")} />
            <input
              type="hidden"
              {...form.register("cantidadEnvases", { valueAsNumber: true })}
            />
            <input type="hidden" {...form.register("envaseTipoId")} />
            <input type="hidden" {...form.register("envaseEstado")} />

            <div className="grid gap-x-12 gap-y-7 md:grid-cols-2">
              <ModalField
                error={form.formState.errors.fechaOperacion?.message}
                label="Fecha"
              >
                <input
                  className="modal-field"
                  type="date"
                  {...form.register("fechaOperacion")}
                />
              </ModalField>
              <ModalAutocompleteField
                datalistId="descargas-proveedor-opciones"
                error={form.formState.errors.proveedor?.message}
                label="Proveedor o procedencia*"
                options={relationalOptions.proveedor}
                placeholder="Proveedor o procedencia"
                registration={registerRelationalField("proveedor")}
              />
              <ModalAutocompleteField
                datalistId="descargas-cliente-opciones"
                error={form.formState.errors.cliente?.message}
                label="Cliente*"
                options={relationalOptions.cliente}
                placeholder="Cliente"
                registration={registerRelationalField("cliente")}
              />
              <ModalField
                error={
                  hasCartaPorte
                    ? form.formState.errors.numeroCartaPorte?.message
                    : undefined
                }
                label="Carta de porte"
              >
                <div className="grid gap-3">
                  <label className="flex items-center gap-3 text-sm font-semibold text-[var(--modal-ink)]">
                    <input
                      checked={hasCartaPorte}
                      onChange={(event) =>
                        setHasCartaPorte(event.target.checked)
                      }
                      type="checkbox"
                    />
                    Informar carta de porte
                  </label>
                  {hasCartaPorte ? (
                    <input
                      className="modal-field"
                      placeholder="CP-000123"
                      {...form.register("numeroCartaPorte")}
                    />
                  ) : (
                    <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-[var(--modal-muted)] ring-1 ring-[var(--modal-line)]">
                      Se registrara sin carta de porte visible.
                    </div>
                  )}
                </div>
              </ModalField>
              <ModalAutocompleteField
                datalistId="descargas-producto-opciones"
                error={form.formState.errors.producto?.message}
                label="Producto*"
                options={relationalOptions.producto}
                placeholder="Producto"
                registration={registerRelationalField("producto", {
                  validate: (value: string | undefined) =>
                    value?.trim().length ? true : "El producto es obligatorio.",
                })}
              />
              <ModalField
                error={form.formState.errors.kilos?.message}
                label="Kg ingresados*"
              >
                <input
                  className="modal-field"
                  min="0"
                  step="0.01"
                  type="number"
                  {...form.register("kilos", { valueAsNumber: true })}
                />
              </ModalField>
              <ModalAutocompleteField
                datalistId="descargas-proceso-opciones"
                error={form.formState.errors.proceso?.message}
                label="Proceso*"
                options={relationalOptions.proceso}
                placeholder="Proceso"
                registration={registerRelationalField("proceso")}
              />
              <ModalField label="Envases">
                <div className="grid gap-3">
                  <label className="flex items-center gap-3 text-sm font-semibold text-[var(--modal-ink)]">
                    <input
                      checked={hasEnvases}
                      onChange={(event) => setHasEnvases(event.target.checked)}
                      type="checkbox"
                    />
                    Asociar envases
                  </label>
                  <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-[var(--modal-muted)] ring-1 ring-[var(--modal-line)]">
                    {hasEnvases
                      ? "Puede agregar varios envases y quitar los que no correspondan."
                      : "Este ingreso se guardara sin envases asociados."}
                  </div>
                  {initialSeed.envasesNoMapeados > 0 ? (
                    <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 ring-1 ring-amber-100">
                      {initialSeed.envasesNoMapeados === 1
                        ? "Hay 1 envase con datos incompletos. Reviselo antes de guardar."
                        : `Hay ${initialSeed.envasesNoMapeados} envases con datos incompletos. Reviselos antes de guardar.`}
                    </div>
                  ) : null}
                </div>
              </ModalField>
            </div>

            {hasEnvases ? (
              <section className="grid gap-4 rounded-2xl bg-slate-50/80 p-5 ring-1 ring-[var(--modal-line)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-display text-lg font-bold text-[var(--modal-ink)]">
                      Detalle de envases
                    </p>
                    <p className="mt-1 text-sm text-[var(--modal-muted)]">
                      Tipo, estado, kg y cantidad por cada envase relacionado.
                    </p>
                  </div>
                  <button
                    className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => append({ ...DEFAULT_DESCARGA_ENVASE })}
                    type="button"
                  >
                    Agregar envase
                  </button>
                </div>
                <div className="grid gap-3">
                  {fields.map((field, index) => (
                    <div
                      className="grid gap-3 rounded-2xl bg-white px-4 py-4 ring-1 ring-[var(--modal-line)] md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_110px_110px_auto]"
                      key={field.id}
                    >
                      <label className="grid gap-2 text-xs font-bold text-[var(--modal-muted)]">
                        Tipo
                        <input
                          className="modal-field"
                          list="descargas-envases-sugeridos"
                          placeholder="GRANEL, BOLSA, BOLSON..."
                          {...form.register(
                            `detalleEnvases.${index}.envaseTipoId`,
                          )}
                        />
                      </label>
                      <label className="grid gap-2 text-xs font-bold text-[var(--modal-muted)]">
                        Estado
                        <input
                          className="modal-field"
                          placeholder="Conforme"
                          {...form.register(
                            `detalleEnvases.${index}.envaseEstado`,
                          )}
                        />
                      </label>
                      <label className="grid gap-2 text-xs font-bold text-[var(--modal-muted)]">
                        Kg
                        <input
                          className="modal-field"
                          min="0"
                          step="0.01"
                          type="number"
                          {...form.register(`detalleEnvases.${index}.kilos`, {
                            valueAsNumber: true,
                          })}
                        />
                      </label>
                      <label className="grid gap-2 text-xs font-bold text-[var(--modal-muted)]">
                        Cantidad
                        <input
                          className="modal-field"
                          min="1"
                          step="1"
                          type="number"
                          {...form.register(
                            `detalleEnvases.${index}.cantidad`,
                            { valueAsNumber: true },
                          )}
                        />
                      </label>
                      <div className="flex items-end">
                        <button
                          className="w-full rounded-xl bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700 ring-1 ring-rose-100 transition hover:bg-rose-100"
                          onClick={() => remove(index)}
                          type="button"
                        >
                          Quitar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <datalist id="descargas-envases-sugeridos">
                  {[
                    ...new Set([
                      "GRANEL",
                      "BOLSA",
                      "BOLSON",
                      "OTRO",
                      ...envases.map((envase) => envase.nombre),
                    ]),
                  ].map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </section>
            ) : null}

            <ModalField
              error={form.formState.errors.observaciones?.message}
              label="Observaciones"
            >
              <textarea
                className="modal-field min-h-28 resize-none"
                placeholder="Observaciones"
                {...form.register("observaciones")}
              />
            </ModalField>

            {serverError ? (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 ring-1 ring-red-100">
                {serverError}
              </div>
            ) : null}
          </div>

          <div className="modal-footer flex flex-wrap justify-end gap-4 border-t border-[var(--modal-line)] px-8 py-6">
            <button
              className="rounded-xl px-6 py-3 text-xs font-bold text-[var(--modal-muted)] hover:bg-slate-100 hover:text-[var(--modal-ink)]"
              onClick={onClose}
              type="button"
            >
              Descartar
            </button>
            <button
              className="rounded-xl bg-sky-600 px-8 py-3 text-xs font-bold text-white shadow-lg shadow-sky-600/20 transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPending}
              type="submit"
            >
              {isPending
                ? isEditMode
                  ? "Actualizando..."
                  : "Guardando..."
                : isEditMode
                  ? "Guardar cambios"
                  : "Guardar ingreso"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
