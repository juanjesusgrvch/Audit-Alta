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
import { EyeIcon, PencilIcon, TrashIcon } from "@/app/components/console-icons";
import { ConsoleShell } from "@/app/components/console-shell";
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
import {
  readModuleUiState,
  writeModuleUiState,
} from "@/lib/client/module-ui-state";
import { syncRelationalAutoFilledFields } from "@/lib/client/relational-autofill";
import { refreshAllModuleData } from "@/lib/client/module-data";
import {
  buildStoredProcessLots,
  type StoredProcessLot,
} from "@/lib/shared/stored-process-lots";
import {
  compactarEspacios,
  construirEnvaseInventoryId,
  construirEnvaseTipoIdManual,
  fechaIsoLocalToDate,
} from "@/lib/utils";
import type {
  EnvaseOption,
  OperacionMutationData,
  RegistroOperacion,
} from "@/lib/services/operaciones";
import type { RegistroProceso } from "@/lib/services/procesos";
import {
  operacionEgresoFormSchema,
  type ActionState,
  type OperacionEgresoFormInput,
} from "@/types/schema";

type CargasConsoleProps = {
  registros: RegistroOperacion[];
  relationalRecords: RegistroOperacion[];
  envases: EnvaseOption[];
  deepLinkIntent?: "edit" | "delete";
  deepLinkRecordId?: string;
  deepLinkSource?: "envases";
  firestoreDisponible: boolean;
  isLoading?: boolean;
  loadError?: string | null;
  storageConfigurado: boolean;
};

type CargasFilters = {
  query: string;
  from: string;
  to: string;
  cliente: string;
  proceso: string;
  producto: string;
  proveedor: string;
  envase: string;
};

type CargasUiState = {
  filters: CargasFilters;
  selectedCampaignId: string | null;
};

type SegmentMode = "proceso" | "cliente" | "producto";
type DateChartMode = "month" | "year";
type RelationalFieldKey = "cliente" | "producto" | "proceso" | "proveedor";

type CargaFormSeed = {
  values: OperacionEgresoFormInput;
  hasEnvases: boolean;
  envasesNoMapeados: number;
  envaseMode: "granel" | "manual" | "envasados";
  storedLotSelections: StoredLotSelection[];
};

type StoredLotSelection = {
  storedItemId: string;
  procesoId: string;
  salidaId: string;
  cliente: string;
  proceso: string;
  producto: string;
  procedencia: string;
  envaseTipoId: string;
  envaseTipoNombre: string;
  envaseEstado: string;
  envaseVisibleId: string;
  pesoEnvaseKg: number;
  cantidad: number;
  kilos: number;
};

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

type DispatchedPackagingEntry = {
  id: string;
  tipo: string;
  kilos: number;
  cantidad: number;
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

type StockShortageItem = {
  id: string;
  disponible: number;
  solicitado: number;
  faltante: number;
  detail?: string;
};

function buildFallbackStoredLotFromSelection(
  selection: StoredLotSelection,
): StoredProcessLot {
  return {
    id: selection.storedItemId,
    storedItemId: selection.storedItemId,
    procesoId: selection.procesoId,
    salidaId: selection.salidaId,
    fechaProceso: null,
    cliente: selection.cliente,
    proceso: selection.proceso,
    producto: selection.producto,
    procedencia: selection.procedencia,
    grado: "exportacion",
    detalle: "Lote reservado en edicion",
    kilosTotal: selection.kilos,
    kilosDisponibles: selection.kilos,
    cantidadTotal: selection.cantidad,
    cantidadDisponible: selection.cantidad,
    envaseTipoId: selection.envaseTipoId,
    envaseTipoNombre: selection.envaseTipoNombre,
    envaseEstado: selection.envaseEstado,
    envaseVisibleId: selection.envaseVisibleId,
    inventoryId: construirEnvaseInventoryId(
      selection.envaseTipoId,
      selection.envaseEstado,
      Number(selection.pesoEnvaseKg ?? 0),
    ),
    pesoEnvaseKg: selection.pesoEnvaseKg,
    tipoOrden: "procesado",
  };
}

const SIN_ENVASE_TIPO_ID = "sin-envases";
const SIN_ENVASE_ESTADO = "Sin envases";
const SIN_ENVASE_NOMBRE = "Sin envases";
const REGISTROS_POR_PAGINA = 8;
const SEGMENTOS_POR_PAGINA = 5;
const SEGMENT_ORDER: SegmentMode[] = ["proceso", "cliente", "producto"];
const RELATIONAL_FIELDS: RelationalFieldKey[] = [
  "cliente",
  "producto",
  "proceso",
  "proveedor",
];
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
const STORED_LOT_GRADE_LABELS: Record<string, string> = {
  exportacion: "Exportacion",
  recupero: "Recupero",
  no_recuperable: "No recuperable",
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

function formatFileSize(sizeBytes: number) {
  return new Intl.NumberFormat("es-AR", {
    maximumFractionDigits: 1,
  }).format(sizeBytes / 1024 / 1024);
}

function getRecordSortValue(record: RegistroOperacion) {
  return record.fechaOperacion?.getTime() ?? record.createdAt?.getTime() ?? 0;
}

function compareRecordsDesc(a: RegistroOperacion, b: RegistroOperacion) {
  return getRecordSortValue(b) - getRecordSortValue(a);
}

function getRecordFieldValue(
  record: RegistroOperacion,
  field: RelationalFieldKey,
) {
  if (field === "proveedor") {
    return (record.procedencia || record.proveedor || "").trim();
  }

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

function getCargaEnvaseLabels(record: RegistroOperacion) {
  if ((record.loteEnvasadoDetalles?.length ?? 0) > 0) {
    return record.loteEnvasadoDetalles.map(
      (detail) =>
        detail.envaseVisibleId || detail.envaseTipoNombre || SIN_ENVASE_NOMBRE,
    );
  }

  return record.detalleEnvases.map(
    (detail) =>
      detail.envaseTipoNombre || detail.envaseTipoId || SIN_ENVASE_NOMBRE,
  );
}

function matchesCargaFilters(
  record: RegistroOperacion,
  filters: CargasFilters,
  ignoredField?: keyof CargasFilters,
) {
  const normalizedQuery = normalize(filters.query.trim());
  const envaseLabels = getCargaEnvaseLabels(record);
  const haystack = normalize(
    [
      record.producto ?? "",
      record.cliente,
      record.proceso,
      record.proveedor,
      record.destinatario,
      record.numeroCartaPorte,
      record.observaciones ?? "",
      ...envaseLabels,
      ...(record.loteEnvasadoDetalles ?? []).map(
        (detail) =>
          `${detail.envaseVisibleId} ${detail.envaseTipoNombre} ${detail.cantidad} ${detail.kilos}`,
      ),
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
    (ignoredField === "envase" ||
      filters.envase === "todos" ||
      envaseLabels.some((label) => label === filters.envase)) &&
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

function buildCargaFormSeed(
  record: RegistroOperacion | null,
  envases: EnvaseOption[],
  todayValue: string,
): CargaFormSeed {
  if (!record) {
    return {
      values: {
        tipoOperacion: "egreso",
        fechaOperacion: todayValue,
        numeroCartaPorte: "",
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
        confirmarStockInsuficiente: false,
        detalleEnvases: [],
        loteEnvasadoDetalles: [],
        observaciones: "",
      },
      hasEnvases: false,
      envasesNoMapeados: 0,
      envaseMode: "granel",
      storedLotSelections: [],
    };
  }

  const mappedDetails = record.detalleEnvases.flatMap((detail) => {
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
    record.detalleEnvases.filter((detail) =>
      hasIncompleteHistoricalEnvaseDetail(detail),
    ).length,
  );

  const storedLotSelections = (record.loteEnvasadoDetalles ?? []).map(
    (detail) => ({
      storedItemId: detail.storedItemId,
      procesoId: detail.procesoId,
      salidaId: detail.salidaId,
      cliente: detail.cliente,
      proceso: detail.proceso,
      producto: detail.producto,
      procedencia: detail.procedencia,
      envaseTipoId: detail.envaseTipoId,
      envaseTipoNombre: detail.envaseTipoNombre,
      envaseEstado: detail.envaseEstado,
      envaseVisibleId: detail.envaseVisibleId,
      pesoEnvaseKg: detail.pesoEnvaseKg,
      cantidad: detail.cantidad,
      kilos: detail.kilos,
    }),
  );

  return {
    values: {
      tipoOperacion: "egreso",
      fechaOperacion: formatDateKey(record.fechaOperacion) || todayValue,
      numeroCartaPorte: record.numeroCartaPorte,
      cliente: record.cliente,
      proveedor: record.proveedor,
      procedencia: record.procedencia,
      destinatario: record.destinatario ?? "",
      proceso: record.proceso,
      producto: record.producto ?? "",
      kilos: record.kilos,
      cantidadEnvases: mappedDetails.reduce(
        (total, detail) => total + Number(detail.cantidad ?? 0),
        0,
      ),
      envaseTipoId: mappedDetails[0]?.envaseTipoId ?? SIN_ENVASE_TIPO_ID,
      envaseEstado: mappedDetails[0]?.envaseEstado ?? SIN_ENVASE_ESTADO,
      envaseMode: record.envaseMode ?? "granel",
      confirmarStockInsuficiente: false,
      detalleEnvases: mappedDetails,
      loteEnvasadoDetalles: storedLotSelections,
      observaciones: record.observaciones ?? "",
    },
    hasEnvases:
      storedLotSelections.length > 0 ||
      mappedDetails.length > 0 ||
      record.detalleEnvases.length > 0 ||
      record.cantidadEnvases > 0,
    envaseMode: record.envaseMode ?? "granel",
    envasesNoMapeados,
    storedLotSelections,
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
            TN despachadas
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
          No hay salidas netas para la segmentacion seleccionada.
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
          label: `Carga ${currentValue.entries.length + 1}`,
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
            Cargas por fecha
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Navegue por mes o por año. Los puntos acumulan kilos y detallan cada
            carga.
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
          No hay cargas para el periodo y filtros activos.
        </div>
      )}
    </article>
  );
}

function DispatchedPackagingCard({
  entries,
}: {
  entries: DispatchedPackagingEntry[];
}) {
  const entriesPerPage = 4;
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(entries.length / entriesPerPage));
  const visibleEntries = entries.slice(
    page * entriesPerPage,
    (page + 1) * entriesPerPage,
  );

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages - 1));
  }, [totalPages]);

  return (
    <article className="aether-panel rounded-2xl p-5 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-display text-base font-bold text-[var(--text)]">
            Envases despachados
          </p>
        </div>
        <div className="flex items-center gap-2">
          {entries.length > 0 && totalPages > 1 ? (
            <>
              <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                Pagina {page + 1}/{totalPages}
              </span>
              <IconOnlyButton
                disabled={page === 0}
                onClick={() =>
                  setPage((currentPage) => Math.max(0, currentPage - 1))
                }
                title="Pagina anterior"
              >
                <IconChevronLeft />
              </IconOnlyButton>
              <IconOnlyButton
                disabled={page >= totalPages - 1}
                onClick={() =>
                  setPage((currentPage) =>
                    Math.min(totalPages - 1, currentPage + 1),
                  )
                }
                title="Pagina siguiente"
              >
                <IconChevronRight />
              </IconOnlyButton>
            </>
          ) : null}
          <span className="rounded-full bg-[var(--surface-low)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-soft)] ring-1 ring-[var(--line)]">
            Despachado
          </span>
        </div>
      </div>

      {entries.length > 0 ? (
        <div className="mt-5 grid gap-3">
          {visibleEntries.map((entry) => (
            <div
              className="grid gap-2 rounded-2xl bg-[var(--surface-low)] px-3 py-3 ring-1 ring-[var(--line)]"
              key={entry.id}
            >
              <span className="font-display text-sm font-bold text-[var(--text)]">
                {entry.tipo}
              </span>
              <div className="flex items-center justify-between gap-3 text-xs font-semibold text-[var(--text-soft)]">
                <span>{formatKilos(entry.kilos)}</span>
                <span className="font-display text-sm font-bold text-[var(--primary)]">
                  {formatNumber(entry.cantidad, 0)}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state mt-5 grid min-h-52 place-items-center rounded-2xl px-6 text-center text-sm font-semibold text-[var(--text-muted)]">
          No hay envases despachados para los filtros actuales.
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
  const referenciaLabel = record.numeroCartaPorte || "Sin referencia";

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
            <EyeIcon className="h-4 w-4" />
          </IconOnlyButton>
          <IconOnlyButton
            disabled={isDeleting}
            onClick={onEdit}
            title="Editar carga"
          >
            <PencilIcon className="h-4 w-4" />
          </IconOnlyButton>
          <IconOnlyButton
            danger
            disabled={isDeleting}
            onClick={onDelete}
            title="Eliminar carga"
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
                <span className="font-bold text-[var(--text)]">
                  Proveedor o procedencia:
                </span>{" "}
                {record.proveedor}
              </p>
              <p className="mt-2">
                <span className="font-bold text-[var(--text)]">
                  Destinatario:
                </span>{" "}
                {record.destinatario || "Sin destinatario"}
              </p>
              <p className="mt-2">
                <span className="font-bold text-[var(--text)]">
                  Carta de porte o remito:
                </span>{" "}
                {referenciaLabel}
              </p>
              {record.cartaPorteUrl ? (
                <a
                  className="link-chip mt-3 inline-flex rounded-lg px-3 py-2 text-xs font-bold"
                  href={record.cartaPorteUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Abrir PDF
                </a>
              ) : (
                <span className="mt-3 inline-flex rounded-lg px-3 py-2 text-xs font-bold text-[var(--text-muted)] ring-1 ring-[var(--line)]">
                  Sin PDF
                </span>
              )}
            </div>
            <div className="rounded-xl bg-[var(--surface-low)] px-4 py-3 ring-1 ring-[var(--line)]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[var(--text-muted)]">
                  Envases
                </p>
                <span className="rounded-full bg-[var(--surface-high)] px-3 py-1.5 text-[11px] font-bold text-[var(--text-soft)] ring-1 ring-[var(--line)]">
                  {(record.envaseMode === "envasados" ||
                    record.envaseMode === "granel") &&
                  (record.loteEnvasadoDetalles?.length ?? 0) > 0
                    ? record.envaseMode === "granel"
                      ? `${record.cantidadEnvases} envases devueltos`
                      : `${record.cantidadEnvases} bolsones`
                    : record.detalleEnvases.length > 0
                      ? `${record.cantidadEnvases} unidades`
                      : "Sin envases"}
                </span>
              </div>
              {(record.envaseMode === "envasados" ||
                record.envaseMode === "granel") &&
              (record.loteEnvasadoDetalles?.length ?? 0) > 0 ? (
                <div className="mt-3 grid gap-2">
                  {record.loteEnvasadoDetalles.map((detail, index) => (
                    <div
                      className="grid grid-cols-2 gap-3 rounded-xl bg-[var(--surface)]/70 px-3 py-3 text-sm text-[var(--text-soft)] ring-1 ring-[var(--line)] min-[1000px]:grid-cols-[minmax(0,1.6fr)_110px_120px] min-[1000px]:items-center"
                      key={`${record.id}-${detail.storedItemId}-${index}`}
                    >
                      <div className="col-span-2 grid gap-1 min-[1000px]:col-span-1">
                        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)] min-[1000px]:hidden">
                          Lote
                        </span>
                        <span className="font-semibold text-[var(--text)]">
                        {detail.envaseVisibleId} · {detail.proceso}
                        </span>
                      </div>
                      <div className="grid gap-1 min-[1000px]:text-center">
                        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)] min-[1000px]:hidden">
                          Kg
                        </span>
                        <span>
                        {formatKilos(detail.kilos)}
                        </span>
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
              ) : record.detalleEnvases.length > 0 ? (
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
                        <span>
                        {formatKilos(detail.kilos)}
                        </span>
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
                  Esta carga no tiene envases asociados.
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

export function CargasConsole({
  registros,
  relationalRecords,
  envases,
  deepLinkIntent,
  deepLinkRecordId,
  deepLinkSource,
  firestoreDisponible,
  isLoading = false,
  loadError = null,
  storageConfigurado,
}: CargasConsoleProps) {
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
  const [isPersistenceReady, setIsPersistenceReady] = useState(false);
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
  const [filters, setFilters] = useState<CargasFilters>({
    query: "",
    from: "",
    to: "",
    cliente: "todos",
    proceso: "todos",
    producto: "todos",
    proveedor: "todos",
    envase: "todos",
  });
  const selectedCampaign = useMemo(
    () => resolveCampaignPeriod(campaigns, resolvedSelectedCampaignId),
    [campaigns, resolvedSelectedCampaignId],
  );

  useEffect(() => {
    const persisted = readModuleUiState<CargasUiState>("cargas");

    if (persisted) {
      setSelectedCampaignId(persisted.selectedCampaignId);
      setFilters((currentValue) => ({
        ...currentValue,
        ...persisted.filters,
      }));
    }

    setIsPersistenceReady(true);
  }, []);

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
    if (!isPersistenceReady) {
      return;
    }

    writeModuleUiState<CargasUiState>("cargas", {
      filters,
      selectedCampaignId,
    });
  }, [filters, isPersistenceReady, selectedCampaignId]);

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
            matchesCargaFilters(record, scopedFilters, "cliente"),
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
            matchesCargaFilters(record, scopedFilters, "proceso"),
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
            matchesCargaFilters(record, scopedFilters, "producto"),
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
            matchesCargaFilters(record, scopedFilters, "proveedor"),
          )
          .map((record) => record.proveedor),
      ),
    [scopedFilters, sortedRecords],
  );
  const envaseOptions = useMemo(
    () =>
      uniqueValues(
        sortedRecords
          .filter((record) =>
            matchesCargaFilters(record, scopedFilters, "envase"),
          )
          .flatMap((record) => getCargaEnvaseLabels(record)),
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
          record.destinatario,
          record.numeroCartaPorte,
          ...getCargaEnvaseLabels(record),
        ]),
      ),
    [sortedRecords],
  );
  const filteredRecords = useMemo(
    () =>
      sortedRecords.filter((record) =>
        matchesCargaFilters(record, scopedFilters),
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
  const dispatchedPackaging = useMemo(() => {
    const totals = new Map<string, DispatchedPackagingEntry>();

    for (const record of filteredRecords) {
      if (record.envaseMode === "envasados") {
        for (const detail of record.loteEnvasadoDetalles ?? []) {
          if (Number(detail.cantidad ?? 0) <= 0) {
            continue;
          }

          const key = `${detail.envaseTipoNombre || SIN_ENVASE_NOMBRE}__${detail.pesoEnvaseKg}`;
          const currentValue = totals.get(key) ?? {
            id: key,
            tipo: detail.envaseTipoNombre || SIN_ENVASE_NOMBRE,
            kilos: detail.pesoEnvaseKg,
            cantidad: 0,
          };
          currentValue.cantidad += Number(detail.cantidad ?? 0);
          totals.set(key, currentValue);
        }
        continue;
      }

      for (const detail of record.detalleEnvases) {
        if (Number(detail.cantidad ?? 0) <= 0) {
          continue;
        }

        const key = `${detail.envaseTipoNombre || SIN_ENVASE_NOMBRE}__${detail.kilos}`;
        const currentValue = totals.get(key) ?? {
          id: key,
          tipo: detail.envaseTipoNombre || SIN_ENVASE_NOMBRE,
          kilos: detail.kilos,
          cantidad: 0,
        };
        currentValue.cantidad += Number(detail.cantidad ?? 0);
        totals.set(key, currentValue);
      }
    }

    return [...totals.values()].sort((a, b) => {
      if (b.cantidad !== a.cantidad) {
        return b.cantidad - a.cantidad;
      }

      return a.tipo.localeCompare(b.tipo, "es");
    });
  }, [filteredRecords]);
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
    router.replace("/modulos?tab=cargas", { scroll: false });
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
    if (filters.envase !== "todos" && !envaseOptions.includes(filters.envase)) {
      setFilters((currentValue) => ({ ...currentValue, envase: "todos" }));
    }
  }, [envaseOptions, filters.envase]);

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
      `Va a eliminar la carga ${record.producto ?? "sin producto"} del ${formatDisplayDate(record.fechaOperacion)}.`,
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
      const response = await fetchWithFirebaseAuth("/api/cargas", {
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
            : "No fue posible eliminar la carga.",
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
        message: "No se encontro la carga solicitada para abrir desde Envases.",
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
        active="cargas"
        firestoreDisponible={firestoreDisponible}
        footerHint="Cargas manuales con filtros relacionales, resumen operativo y preparacion para futuros cruces con procesos."
        footerLabel={
          firestoreDisponible ? "Cargas online" : "Cargas pendientes"
        }
      >
        <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="flex items-center gap-3 font-display text-4xl font-bold text-[var(--text)]">
              <span>Cargas</span>
              <ModuleLoadingIndicator isLoading={isLoading} />
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-soft)]">
              Egresos con trazabilidad, segmentacion por proceso y envases
              despachados.
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
              placeholder="Buscar cliente, proceso, destinatario o CP"
              suggestions={searchSuggestions}
              value={filters.query}
            />
            <button
              className="primary-action-button rounded-xl px-5 py-3 text-xs font-black text-[var(--primary-ink)] transition hover:brightness-110"
              onClick={() => setIsCreateModalOpen(true)}
              type="button"
            >
              Nueva carga
            </button>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(240px,0.36fr)_minmax(0,1.08fr)_minmax(260px,0.42fr)]">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-1">
            <MetricCard
              helper=""
              label="TN cargadas"
              value={formatToneladasFromKg(kilosFiltrados)}
            />
            <MetricCard
              helper=""
              label="Cantidad de cargas"
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
          <DispatchedPackagingCard entries={dispatchedPackaging} />
        </section>

        <DateTelemetry records={filteredRecords} />

        <ModuleIntegratedFilters
          campaigns={campaigns}
          currentClientLabel={currentClienteLabel}
          filtersClassName="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6"
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
              envase: "todos",
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
          <FilterSelect
            label="Envase"
            onChange={(value) =>
              setFilters((currentValue) => ({
                ...currentValue,
                envase: value,
              }))
            }
            options={envaseOptions}
            value={filters.envase}
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
                Historial de cargas
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
                No hay cargas para los filtros seleccionados.
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
            Storage no esta configurado. Las cargas se registran igual, pero sin
            PDF adjunto.
          </div>
        ) : null}
      </ConsoleShell>

      {isCreateModalOpen ? (
        <CargaModal
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
          relationalRecords={relationalRecords}
        />
      ) : null}

      {editingRecord ? (
        <CargaModal
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
          relationalRecords={relationalRecords}
          recordToEdit={editingRecord}
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

function StockShortageConfirmModal({
  items,
  isPending,
  onCancel,
  onConfirm,
}: {
  items: StockShortageItem[];
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-overlay fixed inset-0 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
      <section className="modal-shell w-full max-w-3xl rounded-2xl bg-[var(--modal-surface)] text-[var(--modal-ink)] ring-1 ring-[rgba(226,232,240,0.7)] backdrop-blur-2xl">
        <div className="border-b border-[var(--modal-line)] px-8 py-7">
          <h3 className="font-display text-3xl font-bold text-[var(--modal-ink)]">
            Confirmar stock insuficiente
          </h3>
          <p className="mt-2 text-sm text-[var(--modal-muted)]">
            La carga supera el stock disponible en algunos envases. Puede
            cancelar para ajustar el detalle o guardar igual para registrar la
            diferencia.
          </p>
        </div>

        <div className="grid gap-4 px-8 py-7">
          <div className="overflow-hidden rounded-2xl border border-[var(--modal-line)]">
            <div className="grid grid-cols-[minmax(0,1.6fr)_110px_110px_110px] gap-3 bg-slate-50 px-4 py-3 text-[11px] font-black uppercase tracking-[0.16em] text-[var(--modal-muted)]">
              <span>ID</span>
              <span className="text-right">Disponible</span>
              <span className="text-right">Solicitado</span>
              <span className="text-right">Faltante</span>
            </div>
            <div className="grid gap-3 px-4 py-4">
              {items.map((item) => (
                <div
                  className="grid grid-cols-[minmax(0,1.6fr)_110px_110px_110px] gap-3 rounded-2xl bg-white px-4 py-4 text-sm text-[var(--modal-ink)] ring-1 ring-[var(--modal-line)]"
                  key={item.id}
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{item.id}</p>
                    {item.detail ? (
                      <p className="mt-1 text-xs text-[var(--modal-muted)]">
                        {item.detail}
                      </p>
                    ) : null}
                  </div>
                  <span className="text-right font-semibold text-[var(--modal-muted)]">
                    {formatNumber(item.disponible, 0)}
                  </span>
                  <span className="text-right font-semibold text-[var(--modal-ink)]">
                    {formatNumber(item.solicitado, 0)}
                  </span>
                  <span className="text-right font-black text-red-700">
                    {formatNumber(item.faltante, 0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-4 border-t border-[var(--modal-line)] px-8 py-6">
          <button
            className="rounded-xl px-6 py-3 text-xs font-bold text-[var(--modal-muted)] hover:bg-slate-100 hover:text-[var(--modal-ink)]"
            onClick={onCancel}
            type="button"
          >
            Cancelar
          </button>
          <button
            className="rounded-xl bg-amber-500 px-8 py-3 text-xs font-black text-slate-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isPending}
            onClick={onConfirm}
            type="button"
          >
            {isPending ? "Guardando..." : "Guardar igual"}
          </button>
        </div>
      </section>
    </div>
  );
}

function CargaModal({
  envases,
  onClose,
  onSuccess,
  records,
  relationalRecords,
  recordToEdit = null,
}: {
  envases: EnvaseOption[];
  onClose: () => void;
  onSuccess: (message: string) => void;
  records: RegistroOperacion[];
  relationalRecords: RegistroOperacion[];
  recordToEdit?: RegistroOperacion | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [pendingSubmitValues, setPendingSubmitValues] =
    useState<OperacionEgresoFormInput | null>(null);
  const [stockShortages, setStockShortages] = useState<StockShortageItem[]>([]);
  const todayValue = formatDateKey(new Date());
  const initialSeed = useMemo(
    () => buildCargaFormSeed(recordToEdit, envases, todayValue),
    [envases, recordToEdit, todayValue],
  );
  const autoFilledFieldsRef = useRef<Set<RelationalFieldKey>>(new Set());
  const manualFieldsRef = useRef<Set<RelationalFieldKey>>(new Set());
  const [hasEnvases, setHasEnvases] = useState(initialSeed.hasEnvases);
  const [envaseMode, setEnvaseMode] = useState<
    "granel" | "manual" | "envasados"
  >(initialSeed.envaseMode);
  const [stockPlantaOptions, setStockPlantaOptions] = useState<
    PlantStockOption[]
  >([]);
  const [processRecords, setProcessRecords] = useState<RegistroProceso[]>([]);
  const [storedLotSelections, setStoredLotSelections] = useState<
    StoredLotSelection[]
  >(initialSeed.storedLotSelections);
  const isEditMode = Boolean(recordToEdit);
  const form = useForm<OperacionEgresoFormInput>({
    resolver: zodResolver(operacionEgresoFormSchema),
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
  const manualStockOptions = useMemo(() => {
    const optionMap = new Map<string, PlantStockOption>();

    for (const entry of stockPlantaOptions) {
      optionMap.set(entry.inventoryId, { ...entry });
    }

    for (const detail of initialSeed.values.detalleEnvases ?? []) {
      const inventoryId = (detail.inventoryId ?? "").trim();
      const restoredCantidad = Number(detail.cantidad ?? 0);

      if (!inventoryId || restoredCantidad <= 0) {
        continue;
      }

      const existingEntry = optionMap.get(inventoryId);

      if (existingEntry) {
        optionMap.set(inventoryId, {
          ...existingEntry,
          cantidad: existingEntry.cantidad + restoredCantidad,
        });
        continue;
      }

      const kilos = Number(detail.kilos ?? 0);
      const envaseTipoId = (detail.envaseTipoId ?? "").trim();
      const envaseTipoNombre =
        (detail.envaseTipoNombre ?? "").trim() || envaseTipoId || "Sin envase";
      const envaseEstado = (detail.envaseEstado ?? "").trim() || "Conforme";

      optionMap.set(inventoryId, {
        inventoryId,
        visibleId: `${envaseTipoNombre} | ${envaseEstado} | ${kilos} kg`,
        envaseTipoId,
        envaseTipoNombre,
        envaseEstado,
        kilos,
        cantidad: restoredCantidad,
      });
    }

    return [...optionMap.values()].sort((a, b) => {
      if (b.kilos !== a.kilos) {
        return b.kilos - a.kilos;
      }

      return a.visibleId.localeCompare(b.visibleId, "es");
    });
  }, [initialSeed.values.detalleEnvases, stockPlantaOptions]);
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
            .concat(relationalRecords)
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
  }, [records, relationalRecords, relationalValues]);
  const storedLots = useMemo(
    () =>
      buildStoredProcessLots(
        processRecords,
        records
          .filter((record) => record.id !== recordToEdit?.id)
          .map((record) => ({
            id: record.id,
            envaseMode: record.envaseMode ?? "granel",
            loteEnvasadoDetalles: record.loteEnvasadoDetalles ?? [],
          })),
      ),
    [processRecords, recordToEdit?.id, records],
  );
  const filteredStoredLots = useMemo(
    () =>
      storedLots.filter((lot) => {
        if (
          cliente.trim() &&
          !normalize(lot.cliente).includes(normalize(cliente))
        ) {
          return false;
        }
        if (
          proceso.trim() &&
          !normalize(lot.proceso).includes(normalize(proceso))
        ) {
          return false;
        }
        if (
          (producto ?? "").trim() &&
          !normalize(lot.producto).includes(normalize(producto ?? ""))
        ) {
          return false;
        }
        return true;
      }),
    [cliente, proceso, producto, storedLots],
  );
  const selectableStoredLots = useMemo(() => {
    const optionMap = new Map<string, StoredProcessLot>();

    for (const lot of filteredStoredLots) {
      optionMap.set(lot.storedItemId, lot);
    }

    for (const selection of storedLotSelections) {
      if (!optionMap.has(selection.storedItemId)) {
        optionMap.set(
          selection.storedItemId,
          buildFallbackStoredLotFromSelection(selection),
        );
      }
    }

    return [...optionMap.values()];
  }, [filteredStoredLots, storedLotSelections]);

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
  const envaseSuggestions = useMemo(
    () =>
      [
        ...new Set([
          "GRANEL",
          "BOLSA",
          "BOLSON",
          "OTRO",
          ...envases.map((envase) => envase.nombre),
        ]),
      ].sort((a, b) => a.localeCompare(b, "es")),
    [envases],
  );

  function getStockShortages(values: OperacionEgresoFormInput) {
    if (envaseMode === "manual") {
      const requestedByInventory = new Map<
        string,
        {
          disponible: number;
          solicitado: number;
          id: string;
        }
      >();

      for (const detail of values.detalleEnvases ?? []) {
        const inventoryId = compactarEspacios(detail.inventoryId ?? "");
        const availableEntry =
          manualStockOptions.find((entry) => entry.inventoryId === inventoryId) ??
          null;
        const rowKey =
          inventoryId ||
          `${detail.envaseTipoId}__${detail.envaseEstado}__${detail.kilos}`;
        const currentValue = requestedByInventory.get(rowKey) ?? {
          disponible: Number(availableEntry?.cantidad ?? 0),
          solicitado: 0,
          id:
            availableEntry?.visibleId ||
            `${detail.envaseTipoNombre || detail.envaseTipoId} | ${detail.envaseEstado} | ${Number(detail.kilos ?? 0)} kg`,
        };

        currentValue.solicitado += Number(detail.cantidad ?? 0);
        requestedByInventory.set(rowKey, currentValue);
      }

      return [...requestedByInventory.values()]
        .filter((item) => item.solicitado > item.disponible)
        .map((item) => ({
          id: item.id,
          disponible: item.disponible,
          solicitado: item.solicitado,
          faltante: item.solicitado - item.disponible,
        }));
    }

    const requestedByLot = new Map<
      string,
      {
        disponible: number;
        solicitado: number;
        id: string;
        detail: string;
      }
    >();

    for (const selection of storedLotSelections) {
      const selectedLot =
        selectableStoredLots.find(
          (lot) => lot.storedItemId === selection.storedItemId,
        ) ?? null;
      const currentValue = requestedByLot.get(selection.storedItemId) ?? {
        disponible: Number(selectedLot?.cantidadDisponible ?? 0),
        solicitado: 0,
        id: selection.envaseVisibleId,
        detail: `${selection.proceso} - ${selection.cliente}`,
      };

      currentValue.solicitado += Number(selection.cantidad ?? 0);
      requestedByLot.set(selection.storedItemId, currentValue);
    }

    return [...requestedByLot.values()]
      .filter((item) => item.solicitado > item.disponible)
      .map((item) => ({
        id: item.id,
        disponible: item.disponible,
        solicitado: item.solicitado,
        faltante: item.solicitado - item.disponible,
        detail: item.detail,
      }));
  }

  function submitCarga(
    values: OperacionEgresoFormInput,
    confirmarStockInsuficiente: boolean,
  ) {
    setServerError(null);

    startTransition(async () => {
      try {
        const requestBody = new FormData();
        const detalle =
          envaseMode === "manual" ? (values.detalleEnvases ?? []) : [];
        const loteEnvasadoDetalles =
          envaseMode === "manual" ? [] : storedLotSelections;
        const totalCantidad =
          envaseMode === "manual"
            ? detalle.reduce(
                (total, item) => total + Number(item.cantidad ?? 0),
                0,
              )
            : loteEnvasadoDetalles.reduce(
                (total, item) => total + Number(item.cantidad ?? 0),
                0,
              );
        const firstDetail =
          envaseMode === "manual" ? detalle[0] : loteEnvasadoDetalles[0];

        if (recordToEdit) {
          requestBody.set("operacionId", recordToEdit.id);
        }

        requestBody.set("fechaOperacion", values.fechaOperacion);
        requestBody.set("numeroCartaPorte", values.numeroCartaPorte);
        requestBody.set("cliente", values.cliente);
        requestBody.set("producto", values.producto?.trim() ?? "");
        requestBody.set("proceso", values.proceso);
        requestBody.set("proveedor", values.proveedor);
        requestBody.set("procedencia", values.proveedor);
        requestBody.set("destinatario", values.destinatario?.trim() ?? "");
        requestBody.set("kilos", String(values.kilos ?? 0));
        requestBody.set("cantidadEnvases", String(totalCantidad));
        requestBody.set(
          "envaseTipoId",
          firstDetail?.envaseTipoId || SIN_ENVASE_TIPO_ID,
        );
        requestBody.set(
          "envaseEstado",
          firstDetail?.envaseEstado || SIN_ENVASE_ESTADO,
        );
        requestBody.set("envaseMode", envaseMode);
        requestBody.set(
          "confirmarStockInsuficiente",
          confirmarStockInsuficiente ? "true" : "false",
        );
        requestBody.set("detalleEnvases", JSON.stringify(detalle));
        requestBody.set(
          "loteEnvasadoDetalles",
          JSON.stringify(loteEnvasadoDetalles),
        );
        requestBody.set("observaciones", values.observaciones ?? "");

        if (pdfFile) {
          requestBody.set("cartaPortePdf", pdfFile);
        }

        const response = await fetchWithFirebaseAuth("/api/cargas", {
          method: recordToEdit ? "PATCH" : "POST",
          body: requestBody,
        });
        const result =
          (await response.json()) as ActionState<OperacionMutationData>;

        if (!result.ok) {
          setServerError(result.message);
          return;
        }

        setPendingSubmitValues(null);
        setStockShortages([]);
        refreshAllModuleData();
        router.refresh();
        onSuccess(result.message);
      } catch (error) {
        setServerError(
          error instanceof Error
            ? error.message
            : `No fue posible ${recordToEdit ? "actualizar" : "registrar"} la carga.`,
        );
      }
    });
  }

  useEffect(() => {
    fetchWithFirebaseAuth("/api/envases")
      .then((res) => res.json())
      .then(
        (data: { stockPlanta?: Array<{ entries?: PlantStockOption[] }> }) => {
          if (!data || !Array.isArray(data.stockPlanta)) {
            return;
          }

          setStockPlantaOptions(
            data.stockPlanta
              .flatMap((group) =>
                Array.isArray(group.entries) ? group.entries : [],
              )
              .sort((a, b) => {
                if (b.kilos !== a.kilos) {
                  return b.kilos - a.kilos;
                }

                return a.visibleId.localeCompare(b.visibleId, "es");
              }),
          );
        },
      )
      .catch(() => undefined);

    fetchWithFirebaseAuth("/api/procesos")
      .then((res) => res.json())
      .then(
        (data: {
          registros?: Array<
            Omit<RegistroProceso, "fechaProceso" | "createdAt"> & {
              fechaProceso: string | null;
              createdAt: string | null;
            }
          >;
        }) => {
          if (!data || !Array.isArray(data.registros)) {
            return;
          }

          setProcessRecords(
            data.registros.map((record) => ({
              ...record,
              fechaProceso: record.fechaKey
                ? fechaIsoLocalToDate(record.fechaKey)
                : record.fechaProceso
                  ? new Date(record.fechaProceso)
                  : null,
              createdAt: record.createdAt ? new Date(record.createdAt) : null,
            })),
          );
        },
      )
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    autoFilledFieldsRef.current = new Set();
    manualFieldsRef.current = new Set();
    setHasEnvases(initialSeed.hasEnvases);
    setEnvaseMode(initialSeed.envaseMode);
    setStoredLotSelections(initialSeed.storedLotSelections);
    setServerError(null);
    setPendingSubmitValues(null);
    setStockShortages([]);
    setPdfFile(null);
    setFileInputKey((currentValue) => currentValue + 1);
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
    if (envaseMode !== "manual") {
      replace([]);
      return;
    }

    setStoredLotSelections([]);

    if (fields.length === 0) {
      append({
        inventoryId: manualStockOptions[0]?.inventoryId ?? "",
        envaseTipoId:
          manualStockOptions[0]?.envaseTipoId ??
          envaseSuggestions[0] ??
          "GRANEL",
        envaseTipoNombre: manualStockOptions[0]?.envaseTipoNombre ?? "",
        envaseEstado: manualStockOptions[0]?.envaseEstado ?? "Conforme",
        kilos: manualStockOptions[0]?.kilos ?? 0,
        cantidad: 1,
      });
    }
  }, [
    append,
    envaseSuggestions,
    fields.length,
    form,
    envaseMode,
    manualStockOptions,
    replace,
  ]);

  useEffect(() => {
    if (envaseMode === "manual") {
      return;
    }

    replace([]);

    if (storedLotSelections.length === 0 && filteredStoredLots.length > 0) {
      const firstLot = filteredStoredLots[0];
      setStoredLotSelections([
        {
          storedItemId: firstLot.storedItemId,
          procesoId: firstLot.procesoId,
          salidaId: firstLot.salidaId,
          cliente: firstLot.cliente,
          proceso: firstLot.proceso,
          producto: firstLot.producto,
          procedencia: firstLot.procedencia,
          envaseTipoId: firstLot.envaseTipoId,
          envaseTipoNombre: firstLot.envaseTipoNombre,
          envaseEstado: firstLot.envaseEstado,
          envaseVisibleId: firstLot.envaseVisibleId,
          pesoEnvaseKg: firstLot.pesoEnvaseKg,
          cantidad: 1,
          kilos: firstLot.pesoEnvaseKg || firstLot.kilosDisponibles,
        },
      ]);
    }
  }, [envaseMode, filteredStoredLots, replace, storedLotSelections.length]);

  useEffect(() => {
    const totalCantidad =
      envaseMode === "manual"
        ? (detalleEnvases ?? []).reduce(
            (total, detail) => total + Number(detail?.cantidad ?? 0),
            0,
          )
        : storedLotSelections.reduce(
            (total, detail) => total + Number(detail.cantidad ?? 0),
            0,
          );
    const firstDetail =
      envaseMode === "manual" ? detalleEnvases?.[0] : storedLotSelections[0];

    form.setValue("cantidadEnvases", totalCantidad, { shouldValidate: false });
    form.setValue(
      "envaseTipoId",
      firstDetail?.envaseTipoId || envaseSuggestions[0] || SIN_ENVASE_TIPO_ID,
      { shouldValidate: false },
    );
    form.setValue(
      "envaseEstado",
      firstDetail?.envaseEstado || SIN_ENVASE_ESTADO,
      {
        shouldValidate: false,
      },
    );
  }, [
    detalleEnvases,
    envaseSuggestions,
    form,
    envaseMode,
    storedLotSelections,
  ]);

  const handleSubmit = form.handleSubmit((values) => {
    setPendingSubmitValues(null);
    setStockShortages([]);

    if (!values.producto?.trim()) {
      form.setError("producto", {
        type: "manual",
        message: "El producto es obligatorio.",
      });
      return;
    }

    if (
      envaseMode === "manual" &&
      (!values.detalleEnvases || values.detalleEnvases.length === 0)
    ) {
      setServerError("Debe agregar al menos un envase o seleccionar granel.");
      return;
    }

    if (envaseMode !== "manual" && storedLotSelections.length === 0) {
      setServerError("Debe seleccionar al menos un lote almacenado.");
      return;
    }

    const shortages = getStockShortages(values);

    if (shortages.length > 0) {
      setPendingSubmitValues(values);
      setStockShortages(shortages);
      setServerError(null);
      return;
    }

    submitCarga(values, false);
  });

  return (
    <>
      <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
        <section className="modal-shell max-h-[94vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-[var(--modal-surface)] text-[var(--modal-ink)] ring-1 ring-[rgba(226,232,240,0.7)] backdrop-blur-2xl">
        <div className="modal-topbar flex items-start justify-between gap-6 border-b border-[var(--modal-line)] px-8 py-7">
          <div>
            <h2 className="font-display text-3xl font-bold text-[var(--modal-ink)]">
              {isEditMode ? "Editar carga" : "Registrar carga manual"}
            </h2>
            <p className="mt-2 text-sm text-[var(--modal-muted)]">
              {isEditMode
                ? "Ajuste la carga seleccionada sin perder su trazabilidad operativa."
                : "Registre un egreso manual con referencia documental y detalle opcional de envases."}
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
                label="Fecha (hoy)*"
              >
                <input
                  className="modal-field"
                  type="date"
                  {...form.register("fechaOperacion")}
                />
              </ModalField>
              <ModalAutocompleteField
                datalistId="cargas-proveedor-opciones"
                error={form.formState.errors.proveedor?.message}
                label="Proveedor o Procedencia*"
                options={relationalOptions.proveedor}
                placeholder="Proveedor o procedencia"
                registration={registerRelationalField("proveedor")}
              />
              <ModalAutocompleteField
                datalistId="cargas-cliente-opciones"
                error={form.formState.errors.cliente?.message}
                label="Cliente*"
                options={relationalOptions.cliente}
                placeholder="Cliente"
                registration={registerRelationalField("cliente")}
              />
              <ModalField
                error={form.formState.errors.destinatario?.message}
                label="Destinatario"
              >
                <input
                  className="modal-field"
                  placeholder="Destinatario"
                  {...form.register("destinatario")}
                />
              </ModalField>
              <ModalAutocompleteField
                datalistId="cargas-proceso-opciones"
                error={form.formState.errors.proceso?.message}
                label="Proceso*"
                options={relationalOptions.proceso}
                placeholder="Proceso"
                registration={registerRelationalField("proceso")}
              />
              <ModalField
                error={form.formState.errors.numeroCartaPorte?.message}
                label="Carta de porte o Remito*"
              >
                <input
                  className="modal-field"
                  placeholder="CP / REM-000123"
                  {...form.register("numeroCartaPorte")}
                />
              </ModalField>
              <ModalAutocompleteField
                datalistId="cargas-producto-opciones"
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
                label="Kilos Netos*"
              >
                <input
                  className="modal-field"
                  min="0"
                  step="0.01"
                  type="number"
                  {...form.register("kilos", { valueAsNumber: true })}
                />
              </ModalField>

              <ModalField
                label="Modalidad de Envases"
                className="col-span-1 md:col-span-2"
              >
                <div className="grid gap-4 md:grid-cols-3">
                  <label
                    className={`flex cursor-pointer flex-col gap-2 rounded-xl p-4 ring-1 transition ${envaseMode === "envasados" ? "bg-sky-50 ring-sky-300" : "bg-white ring-[var(--modal-line)] hover:bg-slate-50"}`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        checked={envaseMode === "envasados"}
                        className="h-4 w-4 text-sky-600"
                        name="envaseMode"
                        onChange={() => setEnvaseMode("envasados")}
                        type="radio"
                      />
                      <span className="font-bold text-[var(--modal-ink)]">
                        Lote (Envasados)
                      </span>
                    </div>
                    <p className="text-xs text-[var(--modal-muted)]">
                      Descuenta mercaderia almacenada desde procesos y mantiene
                      esos envases saliendo con la carga.
                    </p>
                  </label>

                  <label
                    className={`flex cursor-pointer flex-col gap-2 rounded-xl p-4 ring-1 transition ${envaseMode === "manual" ? "bg-emerald-50 ring-emerald-300" : "bg-white ring-[var(--modal-line)] hover:bg-slate-50"}`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        checked={envaseMode === "manual"}
                        className="h-4 w-4 text-emerald-600"
                        name="envaseMode"
                        onChange={() => setEnvaseMode("manual")}
                        type="radio"
                      />
                      <span className="font-bold text-[var(--modal-ink)]">
                        Egreso Manual
                      </span>
                    </div>
                    <p className="text-xs text-[var(--modal-muted)]">
                      Consume envases directamente del stock general para el
                      cliente, sin tocar mercaderia almacenada.
                    </p>
                  </label>

                  <label
                    className={`flex cursor-pointer flex-col gap-2 rounded-xl p-4 ring-1 transition ${envaseMode === "granel" ? "bg-slate-100 ring-slate-300" : "bg-white ring-[var(--modal-line)] hover:bg-slate-50"}`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        checked={envaseMode === "granel"}
                        className="h-4 w-4 text-slate-600"
                        name="envaseMode"
                        onChange={() => setEnvaseMode("granel")}
                        type="radio"
                      />
                      <span className="font-bold text-[var(--modal-ink)]">
                        A Granel
                      </span>
                    </div>
                    <p className="text-xs text-[var(--modal-muted)]">
                      Descarga mercaderia almacenada a granel y devuelve sus
                      envases al stock general de planta.
                    </p>
                  </label>
                </div>

                {initialSeed.envasesNoMapeados > 0 ? (
                  <div className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 ring-1 ring-amber-100">
                    {initialSeed.envasesNoMapeados === 1
                      ? "Hay 1 envase con datos incompletos. Reviselo antes de guardar."
                      : `Hay ${initialSeed.envasesNoMapeados} envases con datos incompletos. Reviselos antes de guardar.`}
                  </div>
                ) : null}
              </ModalField>
            </div>

            {envaseMode === "manual" ? (
              <section className="grid gap-4 rounded-2xl bg-slate-50/80 p-5 ring-1 ring-[var(--modal-line)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-display text-lg font-bold text-[var(--modal-ink)]">
                      Egreso manual de envases
                    </p>
                    <p className="mt-1 text-sm text-[var(--modal-muted)]">
                      Seleccione IDs del stock general de planta para
                      descontarlos como consumo del cliente.
                    </p>
                  </div>
                  <button
                    className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() =>
                      append({
                        inventoryId: manualStockOptions[0]?.inventoryId ?? "",
                        envaseTipoId:
                          manualStockOptions[0]?.envaseTipoId ??
                          envases[0]?.id ??
                          "GRANEL",
                        envaseTipoNombre:
                          manualStockOptions[0]?.envaseTipoNombre ?? "",
                        envaseEstado:
                          manualStockOptions[0]?.envaseEstado ?? "Conforme",
                        kilos: manualStockOptions[0]?.kilos ?? 0,
                        cantidad: 1,
                      })
                    }
                    type="button"
                  >
                    Agregar envase
                  </button>
                </div>
                <div className="grid gap-3">
                  {fields.map((field, index) => {
                    const selectedInventoryId =
                      form.watch(`detalleEnvases.${index}.inventoryId`) ?? "";

                    return (
                      <div
                        className="grid gap-3 rounded-2xl bg-white px-4 py-4 ring-1 ring-[var(--modal-line)] md:grid-cols-[minmax(0,1fr)_120px_auto]"
                        key={field.id}
                      >
                        <input
                          type="hidden"
                          {...form.register(
                            `detalleEnvases.${index}.inventoryId`,
                          )}
                        />
                        <input
                          type="hidden"
                          {...form.register(
                            `detalleEnvases.${index}.envaseTipoId`,
                          )}
                        />
                        <input
                          type="hidden"
                          {...form.register(
                            `detalleEnvases.${index}.envaseTipoNombre`,
                          )}
                        />
                        <input
                          type="hidden"
                          {...form.register(
                            `detalleEnvases.${index}.envaseEstado`,
                          )}
                        />
                        <input
                          type="hidden"
                          {...form.register(`detalleEnvases.${index}.kilos`, {
                            valueAsNumber: true,
                          })}
                        />
                        <label className="grid gap-2 text-xs font-bold text-[var(--modal-muted)]">
                          Envase
                          <select
                            className="modal-field bg-white"
                            onChange={(event) => {
                              const selectedEntry =
                                manualStockOptions.find(
                                  (entry) =>
                                    entry.inventoryId === event.target.value,
                                ) ?? null;
                              form.setValue(
                                `detalleEnvases.${index}.inventoryId`,
                                selectedEntry?.inventoryId ?? "",
                                { shouldValidate: true },
                              );
                              form.setValue(
                                `detalleEnvases.${index}.envaseTipoId`,
                                selectedEntry?.envaseTipoId ?? "",
                                { shouldValidate: true },
                              );
                              form.setValue(
                                `detalleEnvases.${index}.envaseTipoNombre`,
                                selectedEntry?.envaseTipoNombre ?? "",
                                { shouldValidate: true },
                              );
                              form.setValue(
                                `detalleEnvases.${index}.envaseEstado`,
                                selectedEntry?.envaseEstado ?? "",
                                { shouldValidate: true },
                              );
                              form.setValue(
                                `detalleEnvases.${index}.kilos`,
                                Number(selectedEntry?.kilos ?? 0),
                                { shouldValidate: true },
                              );
                            }}
                            value={selectedInventoryId}
                          >
                            {manualStockOptions.map((entry) => (
                              <option
                                key={entry.inventoryId}
                                value={entry.inventoryId}
                              >
                                {entry.visibleId} (Stock: {entry.cantidad})
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="grid gap-2 text-xs font-bold text-[var(--modal-muted)]">
                          Cantidad
                          <input
                            className="modal-field"
                            min="1"
                            step="1"
                            type="number"
                            {...form.register(`detalleEnvases.${index}.cantidad`, {
                              valueAsNumber: true,
                            })}
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
                    );
                  })}
                </div>
              </section>
            ) : null}

            {envaseMode !== "manual" ? (
              <section className="grid gap-4 rounded-2xl bg-slate-50/80 p-5 ring-1 ring-[var(--modal-line)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-display text-lg font-bold text-[var(--modal-ink)]">
                      {envaseMode === "granel"
                        ? "Lote de mercaderia a granel"
                        : "Lote de mercaderia envasada"}
                    </p>
                    <p className="mt-1 text-sm text-[var(--modal-muted)]">
                      {envaseMode === "granel"
                        ? "Seleccione mercaderia almacenada para descargarla y devolver esos envases al stock general."
                        : "Seleccione mercaderia almacenada proveniente de procesos y descuente solo ese lote."}
                    </p>
                  </div>
                  <button
                    className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={filteredStoredLots.length === 0}
                    onClick={() => {
                      const firstLot = filteredStoredLots[0];

                      if (!firstLot) {
                        return;
                      }

                      setStoredLotSelections((currentValue) => [
                        ...currentValue,
                        {
                          storedItemId: firstLot.storedItemId,
                          procesoId: firstLot.procesoId,
                          salidaId: firstLot.salidaId,
                          cliente: firstLot.cliente,
                          proceso: firstLot.proceso,
                          producto: firstLot.producto,
                          procedencia: firstLot.procedencia,
                          envaseTipoId: firstLot.envaseTipoId,
                          envaseTipoNombre: firstLot.envaseTipoNombre,
                          envaseEstado: firstLot.envaseEstado,
                          envaseVisibleId: firstLot.envaseVisibleId,
                          pesoEnvaseKg: firstLot.pesoEnvaseKg,
                          cantidad: 1,
                          kilos:
                            firstLot.pesoEnvaseKg || firstLot.kilosDisponibles,
                        },
                      ]);
                    }}
                    type="button"
                  >
                    Agregar lote
                  </button>
                </div>
                <div className="grid gap-3">
                  {storedLotSelections.map((selection, index) => {
                    const selectedLot =
                      selectableStoredLots.find(
                        (lot) => lot.storedItemId === selection.storedItemId,
                      ) ??
                      storedLots.find(
                        (lot) => lot.storedItemId === selection.storedItemId,
                      ) ??
                      buildFallbackStoredLotFromSelection(selection) ??
                      null;
                    const maxCantidad =
                      selectedLot?.cantidadDisponible ?? selection.cantidad;
                    const maxKilos =
                      selectedLot?.kilosDisponibles ?? selection.kilos;

                    return (
                      <div
                        className="grid gap-3 rounded-2xl bg-white px-4 py-4 ring-1 ring-[var(--modal-line)] md:grid-cols-[minmax(0,1.8fr)_110px_130px_auto]"
                        key={`${selection.storedItemId}-${index}`}
                      >
                        <label className="grid gap-2 text-xs font-bold text-[var(--modal-muted)]">
                          Lote almacenado
                          <select
                            className="modal-field bg-white"
                            onChange={(event) => {
                              const nextLot =
                                selectableStoredLots.find(
                                  (lot) =>
                                    lot.storedItemId === event.target.value,
                                ) ?? null;

                              if (!nextLot) {
                                return;
                              }

                              setStoredLotSelections((currentValue) =>
                                currentValue.map((currentItem, currentIndex) =>
                                  currentIndex === index
                                    ? {
                                        storedItemId: nextLot.storedItemId,
                                        procesoId: nextLot.procesoId,
                                        salidaId: nextLot.salidaId,
                                        cliente: nextLot.cliente,
                                        proceso: nextLot.proceso,
                                        producto: nextLot.producto,
                                        procedencia: nextLot.procedencia,
                                        envaseTipoId: nextLot.envaseTipoId,
                                        envaseTipoNombre:
                                          nextLot.envaseTipoNombre,
                                        envaseEstado: nextLot.envaseEstado,
                                        envaseVisibleId:
                                          nextLot.envaseVisibleId,
                                        pesoEnvaseKg: nextLot.pesoEnvaseKg,
                                        cantidad: 1,
                                        kilos:
                                          nextLot.pesoEnvaseKg ||
                                          nextLot.kilosDisponibles,
                                      }
                                    : currentItem,
                                ),
                              );
                            }}
                            value={selection.storedItemId}
                          >
                            {selectableStoredLots.map((lot) => (
                              <option
                                key={lot.storedItemId}
                                value={lot.storedItemId}
                              >
                                {formatKilos(lot.kilosDisponibles)} |{" "}
                                {STORED_LOT_GRADE_LABELS[lot.grado] ??
                                  lot.grado}{" "}
                                | {lot.envaseVisibleId} | {lot.proceso} |{" "}
                                {lot.cliente} ({lot.cantidadDisponible})
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="grid gap-2 text-xs font-bold text-[var(--modal-muted)]">
                          Cant. envases
                          <input
                            className="modal-field"
                            min="1"
                            step="1"
                            type="number"
                            value={selection.cantidad}
                            onChange={(event) => {
                              const nextCantidad = Math.max(
                                1,
                                Number(event.target.value || 1),
                              );
                              setStoredLotSelections((currentValue) =>
                                currentValue.map((currentItem, currentIndex) =>
                                  currentIndex === index
                                    ? {
                                        ...currentItem,
                                        cantidad: nextCantidad,
                                        kilos:
                                          currentItem.pesoEnvaseKg > 0
                                            ? Number(
                                                (
                                                  nextCantidad *
                                                  currentItem.pesoEnvaseKg
                                                ).toFixed(2),
                                              )
                                            : currentItem.kilos,
                                      }
                                    : currentItem,
                                ),
                              );
                            }}
                          />
                        </label>
                        <label className="grid gap-2 text-xs font-bold text-[var(--modal-muted)]">
                          Kg
                          <input
                            className="modal-field"
                            max={maxKilos > 0 ? maxKilos : undefined}
                            min="0.01"
                            step="0.01"
                            type="number"
                            value={selection.kilos}
                            onChange={(event) => {
                              const nextKilos = Math.max(
                                0.01,
                                Number(event.target.value || 0),
                              );
                              setStoredLotSelections((currentValue) =>
                                currentValue.map((currentItem, currentIndex) =>
                                  currentIndex === index
                                    ? {
                                        ...currentItem,
                                        kilos: nextKilos,
                                      }
                                    : currentItem,
                                ),
                              );
                            }}
                          />
                        </label>
                        <div className="flex items-end">
                          <button
                            className="w-full rounded-xl bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700 ring-1 ring-rose-100 transition hover:bg-rose-100"
                            onClick={() =>
                              setStoredLotSelections((currentValue) =>
                                currentValue.filter(
                                  (_, currentIndex) => currentIndex !== index,
                                ),
                              )
                            }
                            type="button"
                          >
                            Quitar
                          </button>
                        </div>
                        <div className="rounded-xl bg-slate-50 px-3 py-3 text-xs font-semibold text-[var(--modal-muted)] ring-1 ring-[var(--modal-line)] md:col-span-4">
                          Disponible: {formatNumber(maxCantidad, 0)} bolsones /{" "}
                          {formatKilos(maxKilos)} · {selection.producto} ·{" "}
                          {selection.procedencia}
                        </div>
                      </div>
                    );
                  })}

                  {storedLotSelections.length === 0 ? (
                    <div className="rounded-2xl bg-white px-4 py-5 text-sm font-semibold text-[var(--modal-muted)] ring-1 ring-[var(--modal-line)]">
                      No hay lotes seleccionados. Complete cliente, proceso o
                      producto para acotar la busqueda y luego agregue un lote.
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
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
              <ModalField
                error={form.formState.errors.root?.serverError?.message}
                label="PDF (opcional)"
              >
                <input
                  accept="application/pdf"
                  className="modal-field file:mr-4 file:rounded-lg file:border-0 file:bg-sky-600 file:px-3 file:py-2 file:text-sm file:font-bold file:text-white"
                  key={fileInputKey}
                  onChange={(event) =>
                    setPdfFile(event.target.files?.[0] ?? null)
                  }
                  type="file"
                />
                {pdfFile ? (
                  <span className="text-xs font-semibold text-[var(--modal-muted)]">
                    Archivo seleccionado: {pdfFile.name} (
                    {formatFileSize(pdfFile.size)} MB)
                  </span>
                ) : isEditMode && recordToEdit?.cartaPorteUrl ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <a
                      className="link-chip inline-flex rounded-lg px-3 py-2 text-xs font-bold"
                      href={recordToEdit.cartaPorteUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Abrir PDF actual
                    </a>
                    <span className="text-xs font-semibold text-[var(--modal-muted)]">
                      Si no selecciona uno nuevo, se conserva el archivo actual.
                    </span>
                  </div>
                ) : (
                  <span className="text-xs font-semibold text-[var(--modal-muted)]">
                    Puede guardar la carga sin PDF adjunto.
                  </span>
                )}
              </ModalField>
            </div>

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
                  : "Registrar carga"}
            </button>
          </div>
        </form>
        </section>
      </div>

      {stockShortages.length > 0 ? (
        <StockShortageConfirmModal
          isPending={isPending}
          items={stockShortages}
          onCancel={() => {
            setPendingSubmitValues(null);
            setStockShortages([]);
          }}
          onConfirm={() => {
            if (!pendingSubmitValues) {
              return;
            }

            const nextValues = pendingSubmitValues;
            setStockShortages([]);
            submitCarga(nextValues, true);
          }}
        />
      ) : null}
    </>
  );
}
