"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useForm } from "react-hook-form";
import { CampaignSelectorCard } from "@/app/components/campaign-selector-card";
import { ConsoleShell } from "@/app/components/console-shell";
import { EyeIcon, PencilIcon, TrashIcon } from "@/app/components/console-icons";
import { ModuleFilterField } from "@/app/components/module-filters-panel";
import { ModuleLoadingIndicator } from "@/app/components/module-loading-indicator";
import { ModuleSearchBox } from "@/app/components/module-search-box";
import { PaginationControls } from "@/app/components/pagination-controls";
import { fetchWithFirebaseAuth } from "@/lib/client/auth-fetch";
import {
  getDefaultCampaignId,
  mergeCampaignDateRange,
  resolveCampaignPeriod,
  useCampaignPeriods,
} from "@/lib/client/campaign-periods";
import { refreshAllModuleData } from "@/lib/client/module-data";
import type { EnvasesLedgerHistoryRecord } from "@/lib/services/envases-module";
import type { EnvaseOption } from "@/lib/services/operaciones";
import { compactarEspacios, construirEnvaseTipoIdManual } from "@/lib/utils";
import {
  envaseBajaFormSchema,
  envaseIngresoManualFormSchema,
  type ActionState,
  type EnvaseBajaFormInput,
  type EnvaseIngresoManualFormInput,
} from "@/types/schema";

type PlantStockEntry = {
  inventoryId: string;
  visibleId: string;
  envaseTipoId: string;
  envaseTipoCodigo: string;
  envaseTipoNombre: string;
  envaseEstado: string;
  kilos: number;
  cantidad: number;
  transactionCount: number;
};

type PlantStockGroup = {
  kg: number;
  totalCantidad: number;
  totalRegistros: number;
  entries: PlantStockEntry[];
};

type EnvasesConsoleProps = {
  clientesDisponibles: string[];
  envases: EnvaseOption[];
  firestoreDisponible: boolean;
  historialDerivado: EnvasesLedgerHistoryRecord[];
  isLoading?: boolean;
  loadError?: string | null;
  stockPlanta: PlantStockGroup[];
};

type FilterState = {
  from: string;
  historyId: string;
  historyKg: string;
  movementType: string;
  to: string;
};

type AccountTab = "ingresos" | "consumos" | "bajas";

type AccountItem = {
  inventoryId: string;
  visibleId: string;
  kilos: number;
  ingresos: number;
  consumos: number;
  bajas: number;
  saldo: number;
  detalle: Record<AccountTab, EnvasesLedgerHistoryRecord[]>;
};

type AccountGroup = {
  kg: number;
  items: AccountItem[];
  totalBajas: number;
  totalConsumos: number;
  totalIngresos: number;
};

type ManualMutationData = { movimientoId: string };

const REGISTROS_POR_PAGINA = 8;

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function uniqueValues(values: Array<string | null | undefined>) {
  return [
    ...new Set(
      values.map((value) => compactarEspacios(value ?? "")).filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, "es"));
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

function getMovementDate(movement: EnvasesLedgerHistoryRecord) {
  return movement.fechaMovimiento ?? movement.createdAt ?? null;
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

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat("es-AR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatQuantity(value: number) {
  return `${formatNumber(value, 0)} u.`;
}

function movementTypeLabel(movement: EnvasesLedgerHistoryRecord) {
  if (movement.movementKind === "ingreso") {
    return movement.recordOrigin === "manual" ? "Ingreso manual" : "Ingreso";
  }

  if (movement.movementKind === "consumo_egreso_manual") {
    return "Egreso manual";
  }

  if (movement.movementKind === "consumo_proceso") {
    return movement.registroLabel === "Reproceso" ? "Reproceso" : "Proceso";
  }

  if (movement.movementKind === "retiro") {
    return "Retiro";
  }

  if (movement.movementKind === "reproceso") {
    return "Reproceso";
  }

  return "Baja";
}

function getAccountDetailReference(
  movement: EnvasesLedgerHistoryRecord,
  tab: AccountTab,
) {
  if (tab === "bajas") {
    return {
      label: movement.movementKind === "retiro" ? "Retiro" : "Causa",
      value:
        movement.causa ||
        movement.referenciaLabel ||
        movementTypeLabel(movement),
    };
  }

  if (tab === "consumos") {
    return {
      label: "Registro",
      value:
        movement.referenciaLabel ||
        movement.registroLabel ||
        movementTypeLabel(movement),
    };
  }

  if (movement.recordOrigin === "descarga" && movement.referenciaLabel) {
    return {
      label: "Carta de porte",
      value: movement.referenciaLabel,
    };
  }

  return {
    label: "Registro",
    value: movement.referenciaLabel || "Ingreso manual",
  };
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

function matchesSearch(movement: EnvasesLedgerHistoryRecord, query: string) {
  const normalizedQuery = normalize(query);

  if (!normalizedQuery) {
    return true;
  }

  return [
    movement.cliente,
    movement.visibleId,
    movement.registroLabel,
    movementTypeLabel(movement),
    movement.producto,
    movement.proceso,
    movement.procedencia,
    movement.referenciaLabel,
    movement.observaciones,
    movement.causa,
    String(movement.kilos),
  ]
    .filter(Boolean)
    .some((value) => normalize(String(value)).includes(normalizedQuery));
}

function getHistoryRowTone(movement: EnvasesLedgerHistoryRecord) {
  if (movement.movementKind === "ingreso") {
    return "border-emerald-100 bg-emerald-50/45";
  }

  if (movement.movementKind === "consumo_proceso") {
    return "border-sky-100 bg-sky-50/45";
  }

  if (movement.movementKind === "consumo_egreso_manual") {
    return "border-cyan-100 bg-cyan-50/45";
  }

  if (movement.movementKind === "retiro") {
    return "border-amber-100 bg-amber-50/45";
  }

  if (movement.movementKind === "reproceso") {
    return "border-violet-100 bg-violet-50/45";
  }

  return "border-rose-100 bg-rose-50/45";
}

function isManualEditable(movement: EnvasesLedgerHistoryRecord) {
  return movement.recordOrigin === "manual" && Boolean(movement.manualOrigin);
}

function buildOriginModuleHref(
  movement: EnvasesLedgerHistoryRecord,
  intent: "edit" | "delete",
) {
  const sourceId = movement.sourceId?.trim();

  if (!sourceId) {
    return null;
  }

  const params = new URLSearchParams({
    intent,
    recordId: sourceId,
    source: "envases",
    tab:
      movement.recordOrigin === "descarga"
        ? "descargas"
        : movement.recordOrigin === "carga"
          ? "cargas"
          : "procesos",
  });

  if (movement.recordOrigin === "proceso" && movement.sourceSubId) {
    params.set("subRecordId", movement.sourceSubId);
  }

  return `/modulos?${params.toString()}`;
}

function findEnvaseOption(envases: EnvaseOption[], rawValue: string) {
  const normalizedValue = normalize(rawValue);

  return (
    envases.find((envase) => normalize(envase.id) === normalizedValue) ??
    envases.find((envase) => normalize(envase.nombre) === normalizedValue) ??
    envases.find((envase) => normalize(envase.codigo) === normalizedValue) ??
    null
  );
}

function buildAccountGroups(movements: EnvasesLedgerHistoryRecord[]) {
  const items = new Map<string, AccountItem>();

  for (const movement of movements) {
    if (!movement.countsTowardAccount) {
      continue;
    }

    const current = items.get(movement.inventoryId) ?? {
      inventoryId: movement.inventoryId,
      visibleId: movement.visibleId,
      kilos: movement.kilos,
      ingresos: 0,
      consumos: 0,
      bajas: 0,
      saldo: 0,
      detalle: {
        ingresos: [],
        consumos: [],
        bajas: [],
      },
    };

    current.saldo += movement.deltaClientBalance;

    if (movement.movementKind === "ingreso") {
      current.ingresos += movement.cantidad;
      current.detalle.ingresos.push(movement);
    } else if (
      movement.movementKind === "consumo_proceso" ||
      movement.movementKind === "consumo_egreso_manual"
    ) {
      current.consumos += movement.cantidad;
      current.detalle.consumos.push(movement);
    } else if (
      movement.movementKind === "baja" ||
      movement.movementKind === "retiro"
    ) {
      current.bajas += movement.cantidad;
      current.detalle.bajas.push(movement);
    }

    items.set(movement.inventoryId, current);
  }

  const groups = new Map<number, AccountGroup>();

  for (const item of items.values()) {
    const current = groups.get(item.kilos) ?? {
      kg: item.kilos,
      items: [],
      totalBajas: 0,
      totalConsumos: 0,
      totalIngresos: 0,
    };

    current.items.push(item);
    current.totalIngresos += item.ingresos;
    current.totalConsumos += item.consumos;
    current.totalBajas += item.bajas;
    groups.set(item.kilos, current);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) =>
        a.visibleId.localeCompare(b.visibleId, "es"),
      ),
    }))
    .sort((a, b) => b.kg - a.kg);
}

function buildBalanceRows(movements: EnvasesLedgerHistoryRecord[]) {
  const rows = new Map<
    string,
    {
      inventoryId: string;
      visibleId: string;
      ingresos: number;
      consumos: number;
      bajas: number;
      saldo: number;
    }
  >();

  for (const movement of movements) {
    if (!movement.countsTowardAccount) {
      continue;
    }

    const current = rows.get(movement.inventoryId) ?? {
      inventoryId: movement.inventoryId,
      visibleId: movement.visibleId,
      ingresos: 0,
      consumos: 0,
      bajas: 0,
      saldo: 0,
    };

    current.saldo += movement.deltaClientBalance;

    if (movement.movementKind === "ingreso") {
      current.ingresos += movement.cantidad;
    } else if (
      movement.movementKind === "consumo_proceso" ||
      movement.movementKind === "consumo_egreso_manual"
    ) {
      current.consumos += movement.cantidad;
    } else if (
      movement.movementKind === "baja" ||
      movement.movementKind === "retiro"
    ) {
      current.bajas += movement.cantidad;
    }

    rows.set(movement.inventoryId, current);
  }

  return [...rows.values()].sort((a, b) =>
    a.visibleId.localeCompare(b.visibleId, "es"),
  );
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

function ModalField({
  children,
  className = "",
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
      className={`grid gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-[var(--modal-muted)] ${className}`.trim()}
    >
      {label}
      {children}
      {error ? (
        <span className="text-xs font-semibold normal-case tracking-normal text-red-600">
          {error}
        </span>
      ) : null}
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

function PlantStockCard({ group }: { group: PlantStockGroup }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <article className="aether-panel-soft min-w-[270px] max-w-[270px] rounded-2xl px-4 py-4 ring-1 ring-[var(--line)]">
      <button
        className="w-full text-left"
        onClick={() => setIsOpen((value) => !value)}
        type="button"
      >
        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[var(--text-muted)]">
          {group.kg} kg
        </p>
        <p className="mt-2 font-display text-2xl font-bold text-[var(--primary)]">
          {formatQuantity(group.totalCantidad)}
        </p>
        <div className="mt-3 grid gap-1 text-sm font-semibold text-[var(--text-soft)]">
          {group.entries.slice(0, 3).map((entry) => (
            <span className="flex items-start gap-2" key={entry.inventoryId}>
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--primary)]" />
              <span className="line-clamp-1">{entry.visibleId}</span>
            </span>
          ))}
        </div>
        <p className="mt-2 text-xs font-semibold text-[var(--text-muted)]">
          {isOpen ? "Ocultar detalle" : "Ver IDs"} - {group.totalRegistros}{" "}
          movimientos
        </p>
      </button>

      {isOpen ? (
        <div className="mt-4 grid gap-2 border-t border-[var(--line)] pt-4">
          {group.entries.map((entry) => (
            <div
              className="rounded-xl bg-[var(--surface-low)] px-3 py-3 text-sm text-[var(--text-soft)] ring-1 ring-[var(--line)]"
              key={entry.inventoryId}
            >
              <p className="flex items-start gap-2 font-bold text-[var(--text)]">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--primary)]" />
                <span>{entry.visibleId}</span>
              </p>
              <p className="mt-2">Cantidad: {formatQuantity(entry.cantidad)}</p>
              <p className="mt-1">
                Registros fuente: {formatNumber(entry.transactionCount, 0)}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function ClientSelectorCard({
  currentClientLabel,
  disabled,
  onNext,
  onPrev,
}: {
  currentClientLabel: string;
  disabled: boolean;
  onNext: () => void;
  onPrev: () => void;
}) {
  return (
    <section className="aether-panel-soft flex min-h-[110px] flex-col justify-between rounded-2xl px-4 py-4">
      <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)]">
        Cliente activo
      </p>
      <div className="mt-4 grid grid-cols-[42px_minmax(0,1fr)_42px] items-center gap-2">
        <button
          className="console-secondary-button h-11 rounded-xl px-0 text-xs font-bold disabled:opacity-45"
          disabled={disabled}
          onClick={onPrev}
          type="button"
        >
          {"<"}
        </button>
        <div className="flex h-11 items-center justify-center rounded-xl bg-[var(--surface-high)] px-3 text-center ring-1 ring-[var(--line)]">
          <span className="truncate text-sm font-bold text-[var(--text)]">
            {currentClientLabel}
          </span>
        </div>
        <button
          className="console-secondary-button h-11 rounded-xl px-0 text-xs font-bold disabled:opacity-45"
          disabled={disabled}
          onClick={onNext}
          type="button"
        >
          {">"}
        </button>
      </div>
    </section>
  );
}

function ClientAccountCard({
  activeTab,
  group,
  onChangeTab,
  onOpenDetail,
}: {
  activeTab: AccountTab;
  group: AccountGroup;
  onChangeTab: (tab: AccountTab) => void;
  onOpenDetail: (tab: AccountTab, item: AccountItem) => void;
}) {
  const currentItems = useMemo(
    () =>
      group.items.filter((item) => {
        if (activeTab === "ingresos") {
          return item.ingresos > 0;
        }

        if (activeTab === "consumos") {
          return item.consumos > 0;
        }

        return item.bajas > 0;
      }),
    [activeTab, group.items],
  );
  const totalByTab =
    activeTab === "ingresos"
      ? group.totalIngresos
      : activeTab === "consumos"
        ? group.totalConsumos
        : group.totalBajas;

  return (
    <article className="aether-panel-soft rounded-2xl px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[var(--text-muted)]">
            {group.kg} kg
          </p>
          <p className="mt-2 font-display text-2xl font-bold text-[var(--primary)]">
            {formatQuantity(totalByTab)}
          </p>
        </div>
        <div className="inline-flex rounded-xl bg-[var(--surface-low)] p-1 ring-1 ring-[var(--line)]">
          {(["ingresos", "consumos", "bajas"] as AccountTab[]).map((tab) => (
            <button
              className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
                activeTab === tab
                  ? "bg-[var(--nav-active-bg)] text-[var(--primary)]"
                  : "text-[var(--text-soft)] hover:text-[var(--text)]"
              }`}
              key={tab}
              onClick={() => onChangeTab(tab)}
              type="button"
            >
              {tab === "ingresos"
                ? "Ingresos"
                : tab === "consumos"
                  ? "Consumos"
                  : "Bajas"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        {currentItems.length > 0 ? (
          currentItems.map((item) => (
            <button
              className="rounded-xl bg-[var(--surface-low)] px-3 py-3 text-left text-sm text-[var(--text-soft)] ring-1 ring-[var(--line)] transition hover:text-[var(--text)]"
              key={`${activeTab}-${item.inventoryId}`}
              onClick={() => onOpenDetail(activeTab, item)}
              type="button"
            >
              <p className="font-bold text-[var(--text)]">{item.visibleId}</p>
              <p className="mt-1">
                {activeTab === "ingresos"
                  ? formatQuantity(item.ingresos)
                  : activeTab === "consumos"
                    ? formatQuantity(item.consumos)
                    : formatQuantity(item.bajas)}
              </p>
            </button>
          ))
        ) : (
          <div className="rounded-xl bg-[var(--surface-low)] px-3 py-4 text-sm font-semibold text-[var(--text-muted)] ring-1 ring-[var(--line)]">
            No hay movimientos para esta pestaña.
          </div>
        )}
      </div>
    </article>
  );
}

function HistoryRow({
  expanded,
  isPending,
  movement,
  onDelete,
  onEdit,
  onToggle,
}: {
  expanded: boolean;
  isPending: boolean;
  movement: EnvasesLedgerHistoryRecord;
  onDelete: () => void;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const editTitle = isManualEditable(movement)
    ? "Editar movimiento"
    : "Ir al origen para editar";
  const deleteTitle = isManualEditable(movement)
    ? "Eliminar movimiento"
    : "Ir al origen para eliminar";

  return (
    <article
      className={`rounded-xl border px-4 py-3 ${getHistoryRowTone(movement)}`}
    >
      <div className="grid grid-cols-[120px_100px_minmax(0,1fr)_96px_104px] items-center gap-3 md:grid-cols-[150px_120px_minmax(0,1fr)_110px_120px]">
        <button
          className="col-span-4 grid min-w-0 grid-cols-[120px_100px_minmax(0,1fr)_96px] items-center gap-3 text-left md:grid-cols-[150px_120px_minmax(0,1fr)_110px]"
          onClick={onToggle}
          type="button"
        >
          <p className="truncate font-semibold text-[var(--text)]">
            {movementTypeLabel(movement)}
          </p>
          <p className="text-sm font-semibold text-[var(--text-soft)]">
            {formatDisplayDate(getMovementDate(movement))}
          </p>
          <p className="truncate text-sm font-semibold text-[var(--text-soft)]">
            {movement.visibleId}
          </p>
          <p className="font-display text-lg font-bold text-[var(--primary)] md:text-right">
            {formatQuantity(movement.cantidad)}
          </p>
        </button>

        <div className="flex items-center justify-end gap-2">
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
            title={editTitle}
          >
            <PencilIcon className="h-4 w-4" />
          </IconOnlyButton>
          <IconOnlyButton
            danger
            disabled={isPending}
            onClick={onDelete}
            title={deleteTitle}
          >
            <TrashIcon className="h-4 w-4" />
          </IconOnlyButton>
        </div>
      </div>

      {expanded ? (
        <div className="mt-4 border-t border-[var(--line)] pt-4">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-xl bg-[var(--surface-low)] px-4 py-3 text-sm text-[var(--text-soft)] ring-1 ring-[var(--line)]">
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">
                Cliente
              </p>
              <p className="mt-2 font-semibold text-[var(--text)]">
                {movement.cliente}
              </p>
            </div>
            <div className="rounded-xl bg-[var(--surface-low)] px-4 py-3 text-sm text-[var(--text-soft)] ring-1 ring-[var(--line)]">
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">
                ID
              </p>
              <p className="mt-2 font-semibold text-[var(--text)]">
                {movement.visibleId}
              </p>
            </div>
            {movement.producto ? (
              <div className="rounded-xl bg-[var(--surface-low)] px-4 py-3 text-sm text-[var(--text-soft)] ring-1 ring-[var(--line)]">
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Producto
                </p>
                <p className="mt-2 font-semibold text-[var(--text)]">
                  {movement.producto}
                </p>
              </div>
            ) : null}
            {movement.proceso ? (
              <div className="rounded-xl bg-[var(--surface-low)] px-4 py-3 text-sm text-[var(--text-soft)] ring-1 ring-[var(--line)]">
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Proceso
                </p>
                <p className="mt-2 font-semibold text-[var(--text)]">
                  {movement.proceso}
                </p>
              </div>
            ) : null}
            {movement.procedencia ? (
              <div className="rounded-xl bg-[var(--surface-low)] px-4 py-3 text-sm text-[var(--text-soft)] ring-1 ring-[var(--line)]">
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Procedencia
                </p>
                <p className="mt-2 font-semibold text-[var(--text)]">
                  {movement.procedencia}
                </p>
              </div>
            ) : null}
            {movement.referenciaLabel ? (
              <div className="rounded-xl bg-[var(--surface-low)] px-4 py-3 text-sm text-[var(--text-soft)] ring-1 ring-[var(--line)]">
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  {movement.movementKind === "ingreso"
                    ? "Carta de porte"
                    : "Referencia"}
                </p>
                <p className="mt-2 font-semibold text-[var(--text)]">
                  {movement.referenciaLabel}
                </p>
              </div>
            ) : null}
            {movement.causa ? (
              <div className="rounded-xl bg-[var(--surface-low)] px-4 py-3 text-sm text-[var(--text-soft)] ring-1 ring-[var(--line)]">
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Causa
                </p>
                <p className="mt-2 font-semibold text-[var(--text)]">
                  {movement.causa}
                </p>
              </div>
            ) : null}
            {movement.observaciones ? (
              <div className="rounded-xl bg-[var(--surface-low)] px-4 py-3 text-sm text-[var(--text-soft)] ring-1 ring-[var(--line)] sm:col-span-2 xl:col-span-3">
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Observaciones
                </p>
                <p className="mt-2 font-semibold text-[var(--text)]">
                  {movement.observaciones}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function AccountDetailModal({
  client,
  item,
  onClose,
  tab,
}: {
  client: string;
  item: AccountItem;
  onClose: () => void;
  tab: AccountTab;
}) {
  const records = item.detalle[tab];

  return (
    <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <section className="modal-shell max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-[var(--modal-surface)] text-[var(--modal-ink)] ring-1 ring-[rgba(226,232,240,0.7)] backdrop-blur-2xl">
        <div className="modal-topbar flex items-start justify-between gap-6 border-b border-[var(--modal-line)] px-8 py-7">
          <div>
            <h2 className="font-display text-3xl font-bold text-[var(--modal-ink)]">
              {tab === "ingresos"
                ? "Ingresos"
                : tab === "consumos"
                  ? "Consumos"
                  : "Bajas"}
            </h2>
            <p className="mt-2 text-sm text-[var(--modal-muted)]">
              {client} · {item.visibleId}
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

        <div className="max-h-[calc(92vh-112px)] overflow-y-auto px-8 py-7">
          <div className="grid gap-3">
            {records.length > 0 ? (
              records.map((record) => (
                <div
                  className="rounded-2xl bg-[var(--modal-surface-alt)] px-4 py-4 ring-1 ring-[var(--modal-line)]"
                  key={record.id}
                >
                  <div className="grid gap-2 md:grid-cols-[140px_minmax(0,1fr)_90px]">
                    <p className="text-sm font-semibold text-[var(--modal-ink)]">
                      {formatDisplayDate(getMovementDate(record))}
                    </p>
                    <p className="text-sm font-semibold text-[var(--modal-muted)]">
                      {movementTypeLabel(record)} · {record.sourceId}
                    </p>
                    <p className="font-display text-lg font-bold text-[var(--primary)] md:text-right">
                      {formatQuantity(record.cantidad)}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl bg-[var(--modal-surface-alt)] px-4 py-4 text-sm font-semibold text-[var(--modal-muted)] ring-1 ring-[var(--modal-line)]">
                No hay transacciones para este ID.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function AccountMovementDetailModal({
  client,
  item,
  onClose,
  tab,
}: {
  client: string;
  item: AccountItem;
  onClose: () => void;
  tab: AccountTab;
}) {
  const records = item.detalle[tab];

  return (
    <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <section className="modal-shell max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-[var(--modal-surface)] text-[var(--modal-ink)] ring-1 ring-[rgba(226,232,240,0.7)] backdrop-blur-2xl">
        <div className="modal-topbar flex items-start justify-between gap-6 border-b border-[var(--modal-line)] px-8 py-7">
          <div>
            <h2 className="font-display text-3xl font-bold text-[var(--modal-ink)]">
              {tab === "ingresos"
                ? "Ingresos"
                : tab === "consumos"
                  ? "Consumos"
                  : "Bajas"}
            </h2>
            <p className="mt-2 text-sm text-[var(--modal-muted)]">
              {client} - {item.visibleId}
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

        <div className="max-h-[calc(92vh-112px)] overflow-y-auto px-8 py-7">
          <div className="grid gap-3">
            {records.length > 0 ? (
              records.map((record) => {
                const reference = getAccountDetailReference(record, tab);

                return (
                  <div
                    className="rounded-2xl bg-[var(--modal-surface-alt)] px-4 py-4 ring-1 ring-[var(--modal-line)]"
                    key={record.id}
                  >
                    <div className="grid gap-2 md:grid-cols-[140px_minmax(0,1fr)_90px]">
                      <p className="text-sm font-semibold text-[var(--modal-ink)]">
                        {formatDisplayDate(getMovementDate(record))}
                      </p>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--modal-ink)]">
                          {movementTypeLabel(record)}
                        </p>
                        <p className="truncate text-xs font-semibold text-[var(--modal-muted)]">
                          {reference.label}: {reference.value}
                        </p>
                      </div>
                      <p className="font-display text-lg font-bold text-[var(--primary)] md:text-right">
                        {formatQuantity(record.cantidad)}
                      </p>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-2xl bg-[var(--modal-surface-alt)] px-4 py-4 text-sm font-semibold text-[var(--modal-muted)] ring-1 ring-[var(--modal-line)]">
                No hay transacciones para este ID.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function IngresoManualModal({
  clientesDisponibles,
  envases,
  movementToEdit = null,
  onClose,
  onSuccess,
}: {
  clientesDisponibles: string[];
  envases: EnvaseOption[];
  movementToEdit?: EnvasesLedgerHistoryRecord | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const isEditMode = Boolean(movementToEdit);
  const form = useForm<EnvaseIngresoManualFormInput>({
    resolver: zodResolver(envaseIngresoManualFormSchema),
    defaultValues: {
      fechaMovimiento: formatDateKey(
        getMovementDate(movementToEdit ?? ({} as EnvasesLedgerHistoryRecord)) ||
          new Date(),
      ),
      cliente: movementToEdit?.cliente ?? clientesDisponibles[0] ?? "",
      envaseTipoId: movementToEdit?.envaseTipoId ?? "",
      envaseTipoNombre:
        movementToEdit?.envaseTipoNombre ?? envases[0]?.nombre ?? "",
      envaseEstado: movementToEdit?.envaseEstado ?? "USADO",
      kilos: movementToEdit?.kilos ?? 1000,
      cantidad: movementToEdit?.cantidad ?? 1,
      transporte: movementToEdit?.procedencia ?? "Sin detalle",
      observaciones: movementToEdit?.observaciones ?? "",
    },
  });
  const envaseTipoNombre = form.watch("envaseTipoNombre");

  useEffect(() => {
    const resolvedEnvase = findEnvaseOption(envases, envaseTipoNombre ?? "");
    const nextEnvaseId =
      resolvedEnvase?.id ??
      construirEnvaseTipoIdManual(envaseTipoNombre ?? "ENVASE");

    form.setValue("envaseTipoId", nextEnvaseId, {
      shouldDirty: false,
      shouldValidate: true,
    });
  }, [envaseTipoNombre, envases, form]);

  const handleSubmit = form.handleSubmit((values) => {
    setServerError(null);

    startTransition(async () => {
      try {
        const payload = {
          ...values,
          envaseTipoId:
            values.envaseTipoId ||
            construirEnvaseTipoIdManual(values.envaseTipoNombre || "ENVASE"),
          envaseTipoNombre: values.envaseTipoNombre.trim(),
          transporte: values.transporte.trim(),
        };
        const response = isEditMode
          ? await fetchWithFirebaseAuth("/api/envases", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                accion: "editar_ingreso_manual",
                movimientoId: movementToEdit?.id,
                ...payload,
              }),
            })
          : await (() => {
              const formData = new FormData();
              formData.set("accion", "ingreso_manual");
              formData.set("fechaMovimiento", payload.fechaMovimiento);
              formData.set("cliente", payload.cliente);
              formData.set("envaseTipoId", payload.envaseTipoId);
              formData.set("envaseTipoNombre", payload.envaseTipoNombre);
              formData.set("envaseEstado", payload.envaseEstado);
              formData.set("kilos", String(payload.kilos));
              formData.set("cantidad", String(payload.cantidad));
              formData.set("transporte", payload.transporte);
              formData.set("observaciones", payload.observaciones ?? "");
              return fetchWithFirebaseAuth("/api/envases", {
                method: "POST",
                body: formData,
              });
            })();
        const result =
          (await response.json()) as ActionState<ManualMutationData>;

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
            : "No fue posible guardar el ingreso manual.",
        );
      }
    });
  });

  return (
    <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <section className="modal-shell max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-[var(--modal-surface)] text-[var(--modal-ink)] ring-1 ring-[rgba(226,232,240,0.7)] backdrop-blur-2xl">
        <div className="modal-topbar flex items-start justify-between gap-6 border-b border-[var(--modal-line)] px-8 py-7">
          <div>
            <h2 className="font-display text-3xl font-bold text-[var(--modal-ink)]">
              {isEditMode
                ? "Editar ingreso manual"
                : "Ingreso manual de envases"}
            </h2>
            <p className="mt-2 text-sm text-[var(--modal-muted)]">
              Acredita el ingreso en el stock general de planta y en la cuenta
              del cliente.
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
          className="max-h-[calc(92vh-112px)] overflow-y-auto"
          onSubmit={handleSubmit}
        >
          <div className="grid gap-8 px-8 py-7">
            <input type="hidden" {...form.register("envaseTipoId")} />
            <div className="grid gap-x-12 gap-y-7 md:grid-cols-2">
              <ModalField
                error={form.formState.errors.fechaMovimiento?.message}
                label="Fecha*"
              >
                <input
                  className="modal-field"
                  type="date"
                  {...form.register("fechaMovimiento")}
                />
              </ModalField>
              <ModalAutocompleteField
                datalistId="envases-ingreso-cliente"
                error={form.formState.errors.cliente?.message}
                label="Cliente*"
                options={clientesDisponibles}
                placeholder="Cliente"
                registration={form.register("cliente")}
              />
              <ModalAutocompleteField
                datalistId="envases-ingreso-tipo"
                error={form.formState.errors.envaseTipoNombre?.message}
                label="Tipo*"
                options={uniqueValues(envases.map((envase) => envase.nombre))}
                placeholder="Tipo de envase"
                registration={form.register("envaseTipoNombre")}
              />
              <ModalField
                error={form.formState.errors.envaseEstado?.message}
                label="Estado*"
              >
                <input
                  className="modal-field"
                  placeholder="USADO"
                  {...form.register("envaseEstado")}
                />
              </ModalField>
              <ModalField
                error={form.formState.errors.kilos?.message}
                label="Kg*"
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
                error={form.formState.errors.cantidad?.message}
                label="Cantidad*"
              >
                <input
                  className="modal-field"
                  min="1"
                  step="1"
                  type="number"
                  {...form.register("cantidad", { valueAsNumber: true })}
                />
              </ModalField>
              <ModalField
                error={form.formState.errors.transporte?.message}
                label="Transporte / Procedencia*"
              >
                <input
                  className="modal-field"
                  placeholder="Transporte"
                  {...form.register("transporte")}
                />
              </ModalField>
              <ModalField
                className="md:col-span-2"
                error={form.formState.errors.observaciones?.message}
                label="Observaciones"
              >
                <textarea
                  className="modal-field min-h-28 resize-none py-3"
                  placeholder="Observaciones"
                  {...form.register("observaciones")}
                />
              </ModalField>
            </div>

            {serverError ? (
              <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 ring-1 ring-red-100">
                {serverError}
              </div>
            ) : null}
          </div>

          <div className="modal-footer flex items-center justify-end gap-3 border-t border-[var(--modal-line)] px-8 py-5">
            <button
              className="console-secondary-button rounded-xl px-5 py-3 text-xs font-bold"
              onClick={onClose}
              type="button"
            >
              Cancelar
            </button>
            <button
              className="primary-action-button rounded-xl px-6 py-3 text-xs font-black text-[var(--primary-ink)] disabled:opacity-60"
              disabled={isPending}
              type="submit"
            >
              {isPending
                ? "Guardando..."
                : isEditMode
                  ? "Guardar cambios"
                  : "Registrar ingreso"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function BajaRetiroModal({
  clientesDisponibles,
  movementToEdit = null,
  onClose,
  onSuccess,
  stockEntries,
}: {
  clientesDisponibles: string[];
  movementToEdit?: EnvasesLedgerHistoryRecord | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
  stockEntries: PlantStockEntry[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const isEditMode = Boolean(movementToEdit);
  const selectedDefaultInventoryId =
    movementToEdit?.inventoryId ?? stockEntries[0]?.inventoryId ?? "";
  const form = useForm<EnvaseBajaFormInput>({
    resolver: zodResolver(envaseBajaFormSchema),
    defaultValues: {
      fechaMovimiento: formatDateKey(
        getMovementDate(movementToEdit ?? ({} as EnvasesLedgerHistoryRecord)) ||
          new Date(),
      ),
      cliente: movementToEdit?.cliente ?? clientesDisponibles[0] ?? "",
      tipoSalida: movementToEdit?.movementKind === "retiro" ? "retiro" : "baja",
      kilos: movementToEdit?.kilos ?? stockEntries[0]?.kilos ?? 0,
      inventoryId: selectedDefaultInventoryId,
      sourceId: "",
      envaseTipoId:
        movementToEdit?.envaseTipoId ?? stockEntries[0]?.envaseTipoId ?? "",
      envaseEstado:
        movementToEdit?.envaseEstado ?? stockEntries[0]?.envaseEstado ?? "",
      cantidad: movementToEdit?.cantidad ?? 1,
      causa: movementToEdit?.causa ?? "",
      observaciones: movementToEdit?.observaciones ?? "",
    },
  });
  const selectedInventoryId = form.watch("inventoryId");
  const selectedEntry =
    stockEntries.find((entry) => entry.inventoryId === selectedInventoryId) ??
    (movementToEdit
      ? {
          inventoryId: movementToEdit.inventoryId,
          visibleId: movementToEdit.visibleId,
          envaseTipoId: movementToEdit.envaseTipoId,
          envaseTipoCodigo: movementToEdit.envaseTipoCodigo,
          envaseTipoNombre: movementToEdit.envaseTipoNombre,
          envaseEstado: movementToEdit.envaseEstado,
          kilos: movementToEdit.kilos,
          cantidad: movementToEdit.cantidad,
          transactionCount: 1,
        }
      : null);

  useEffect(() => {
    if (!selectedEntry) {
      return;
    }

    form.setValue("envaseTipoId", selectedEntry.envaseTipoId, {
      shouldDirty: false,
      shouldValidate: true,
    });
    form.setValue("envaseEstado", selectedEntry.envaseEstado, {
      shouldDirty: false,
      shouldValidate: false,
    });
    form.setValue("kilos", selectedEntry.kilos, {
      shouldDirty: false,
      shouldValidate: false,
    });
  }, [form, selectedEntry]);

  const handleSubmit = form.handleSubmit((values) => {
    setServerError(null);

    startTransition(async () => {
      try {
        const payload = {
          ...values,
          inventoryId: values.inventoryId,
          envaseTipoId: selectedEntry?.envaseTipoId ?? values.envaseTipoId,
          envaseEstado: selectedEntry?.envaseEstado ?? values.envaseEstado,
          kilos: selectedEntry?.kilos ?? values.kilos,
          sourceId: "",
        };
        const response = isEditMode
          ? await fetchWithFirebaseAuth("/api/envases", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                accion: "editar_baja_manual",
                movimientoId: movementToEdit?.id,
                ...payload,
              }),
            })
          : await (() => {
              const formData = new FormData();
              formData.set("accion", "baja_manual");
              formData.set("fechaMovimiento", payload.fechaMovimiento);
              formData.set("cliente", payload.cliente);
              formData.set("tipoSalida", payload.tipoSalida);
              formData.set("inventoryId", payload.inventoryId);
              formData.set("sourceId", "");
              formData.set("envaseTipoId", payload.envaseTipoId);
              formData.set("envaseEstado", payload.envaseEstado);
              formData.set("kilos", String(payload.kilos));
              formData.set("cantidad", String(payload.cantidad));
              formData.set("causa", payload.causa);
              formData.set("observaciones", payload.observaciones ?? "");
              return fetchWithFirebaseAuth("/api/envases", {
                method: "POST",
                body: formData,
              });
            })();
        const result =
          (await response.json()) as ActionState<ManualMutationData>;

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
            : "No fue posible guardar la salida manual.",
        );
      }
    });
  });

  return (
    <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <section className="modal-shell max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-[var(--modal-surface)] text-[var(--modal-ink)] ring-1 ring-[rgba(226,232,240,0.7)] backdrop-blur-2xl">
        <div className="modal-topbar flex items-start justify-between gap-6 border-b border-[var(--modal-line)] px-8 py-7">
          <div>
            <h2 className="font-display text-3xl font-bold text-[var(--modal-ink)]">
              {isEditMode ? "Editar baja / retiro" : "Registrar baja / retiro"}
            </h2>
            <p className="mt-2 text-sm text-[var(--modal-muted)]">
              Descuenta envases del stock general y del saldo contable del
              cliente.
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
          className="max-h-[calc(92vh-112px)] overflow-y-auto"
          onSubmit={handleSubmit}
        >
          <div className="grid gap-8 px-8 py-7">
            <input type="hidden" {...form.register("sourceId")} />
            <input type="hidden" {...form.register("envaseTipoId")} />
            <input type="hidden" {...form.register("envaseEstado")} />
            <input
              type="hidden"
              {...form.register("kilos", { valueAsNumber: true })}
            />

            <div className="grid gap-x-12 gap-y-7 md:grid-cols-2">
              <ModalField
                error={form.formState.errors.fechaMovimiento?.message}
                label="Fecha*"
              >
                <input
                  className="modal-field"
                  type="date"
                  {...form.register("fechaMovimiento")}
                />
              </ModalField>
              <ModalAutocompleteField
                datalistId="envases-baja-cliente"
                error={form.formState.errors.cliente?.message}
                label="Cliente*"
                options={clientesDisponibles}
                placeholder="Cliente"
                registration={form.register("cliente")}
              />
              <ModalField
                error={form.formState.errors.tipoSalida?.message}
                label="Movimiento*"
              >
                <select
                  className="modal-field bg-white"
                  {...form.register("tipoSalida")}
                >
                  <option value="baja">Baja</option>
                  <option value="retiro">Retiro</option>
                </select>
              </ModalField>
              <ModalField
                error={form.formState.errors.inventoryId?.message}
                label="ID de envase*"
              >
                <select
                  className="modal-field bg-white"
                  {...form.register("inventoryId")}
                >
                  {stockEntries.length > 0 ? (
                    stockEntries.map((entry) => (
                      <option key={entry.inventoryId} value={entry.inventoryId}>
                        {entry.visibleId} ({formatQuantity(entry.cantidad)})
                      </option>
                    ))
                  ) : (
                    <option value="">Sin stock disponible</option>
                  )}
                </select>
              </ModalField>
              <ModalField
                error={form.formState.errors.cantidad?.message}
                label="Cantidad*"
              >
                <input
                  className="modal-field"
                  max={selectedEntry?.cantidad ?? undefined}
                  min="1"
                  step="1"
                  type="number"
                  {...form.register("cantidad", { valueAsNumber: true })}
                />
              </ModalField>
              <ModalField
                error={form.formState.errors.causa?.message}
                label="Causa*"
              >
                <input
                  className="modal-field"
                  placeholder="Causa o motivo"
                  {...form.register("causa")}
                />
              </ModalField>
              <div className="rounded-2xl bg-[var(--modal-surface-alt)] px-4 py-4 ring-1 ring-[var(--modal-line)] md:col-span-2">
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[var(--modal-muted)]">
                  ID seleccionado
                </p>
                <p className="mt-2 text-sm font-semibold text-[var(--modal-ink)]">
                  {selectedEntry?.visibleId ?? "Sin ID disponible"}
                </p>
                <p className="mt-2 text-xs font-semibold text-[var(--modal-muted)]">
                  Stock disponible:{" "}
                  {formatQuantity(selectedEntry?.cantidad ?? 0)}
                </p>
              </div>
              <ModalField
                className="md:col-span-2"
                error={form.formState.errors.observaciones?.message}
                label="Observaciones"
              >
                <textarea
                  className="modal-field min-h-28 resize-none py-3"
                  placeholder="Observaciones"
                  {...form.register("observaciones")}
                />
              </ModalField>
            </div>

            {serverError ? (
              <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 ring-1 ring-red-100">
                {serverError}
              </div>
            ) : null}
          </div>

          <div className="modal-footer flex items-center justify-end gap-3 border-t border-[var(--modal-line)] px-8 py-5">
            <button
              className="console-secondary-button rounded-xl px-5 py-3 text-xs font-bold"
              onClick={onClose}
              type="button"
            >
              Cancelar
            </button>
            <button
              className="primary-action-button rounded-xl px-6 py-3 text-xs font-black text-[var(--primary-ink)] disabled:opacity-60"
              disabled={isPending}
              type="submit"
            >
              {isPending
                ? "Guardando..."
                : isEditMode
                  ? "Guardar cambios"
                  : "Registrar movimiento"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function EnvasesConsole({
  clientesDisponibles,
  envases,
  firestoreDisponible,
  historialDerivado,
  isLoading = false,
  loadError = null,
  stockPlanta,
}: EnvasesConsoleProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState<string>("");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    null,
  );
  const [activeAccountTab, setActiveAccountTab] =
    useState<AccountTab>("ingresos");
  const [filters, setFilters] = useState<FilterState>({
    from: "",
    historyId: "todos",
    historyKg: "todos",
    movementType: "todos",
    to: "",
  });
  const [feedback, setFeedback] = useState<{
    message: string;
    tone: "error" | "success";
  } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(
    null,
  );
  const [showAllClientsHistory, setShowAllClientsHistory] = useState(false);
  const [pendingMovementId, setPendingMovementId] = useState<string | null>(
    null,
  );
  const [isIngresoModalOpen, setIsIngresoModalOpen] = useState(false);
  const [isBajaModalOpen, setIsBajaModalOpen] = useState(false);
  const [editingMovement, setEditingMovement] =
    useState<EnvasesLedgerHistoryRecord | null>(null);
  const [detailState, setDetailState] = useState<{
    client: string;
    item: AccountItem;
    tab: AccountTab;
  } | null>(null);
  const { campaigns } = useCampaignPeriods();
  const defaultCampaignId = useMemo(
    () => getDefaultCampaignId(campaigns),
    [campaigns],
  );
  const resolvedSelectedCampaignId =
    selectedCampaignId ?? defaultCampaignId ?? "all";
  const selectedCampaign = useMemo(
    () => resolveCampaignPeriod(campaigns, resolvedSelectedCampaignId),
    [campaigns, resolvedSelectedCampaignId],
  );
  const availableClients = useMemo(
    () =>
      clientesDisponibles.length > 0
        ? clientesDisponibles
        : uniqueValues(historialDerivado.map((movement) => movement.cliente)),
    [clientesDisponibles, historialDerivado],
  );
  const plantEntries = useMemo(
    () =>
      stockPlanta
        .flatMap((group) => group.entries)
        .sort((a, b) =>
          b.kilos !== a.kilos
            ? b.kilos - a.kilos
            : a.visibleId.localeCompare(b.visibleId, "es"),
        ),
    [stockPlanta],
  );
  const searchSuggestions = useMemo(
    () =>
      uniqueValues(
        historialDerivado.flatMap((movement) => [
          movement.cliente,
          movement.visibleId,
          movementTypeLabel(movement),
          movement.producto,
          movement.proceso,
          movement.procedencia,
          movement.referenciaLabel,
          movement.causa,
          movement.observaciones,
          String(movement.kilos),
        ]),
      ),
    [historialDerivado],
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
    setSelectedClient((currentValue) => {
      if (currentValue && availableClients.includes(currentValue)) {
        return currentValue;
      }

      return availableClients[0] ?? "";
    });
  }, [availableClients]);

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

  const scopedMovements = useMemo(
    () =>
      historialDerivado.filter((movement) => {
        const dateKey = formatDateKey(getMovementDate(movement));

        if (!matchesDateRange(dateKey, scopedFilters.from, scopedFilters.to)) {
          return false;
        }

        return matchesSearch(movement, search);
      }),
    [historialDerivado, scopedFilters.from, scopedFilters.to, search],
  );
  const clientScopedMovements = useMemo(
    () =>
      scopedMovements.filter((movement) => movement.cliente === selectedClient),
    [scopedMovements, selectedClient],
  );
  const accountGroups = useMemo(
    () => buildAccountGroups(clientScopedMovements),
    [clientScopedMovements],
  );
  const balanceRows = useMemo(
    () => buildBalanceRows(clientScopedMovements),
    [clientScopedMovements],
  );
  const historyIdOptions = useMemo(
    () => uniqueValues(scopedMovements.map((movement) => movement.visibleId)),
    [scopedMovements],
  );
  const historyKgOptions = useMemo(
    () =>
      uniqueValues(scopedMovements.map((movement) => String(movement.kilos))),
    [scopedMovements],
  );
  const historyRecords = useMemo(
    () =>
      [...(showAllClientsHistory ? scopedMovements : clientScopedMovements)]
        .filter((movement) => {
          if (
            filters.movementType !== "todos" &&
            movement.movementKind !== filters.movementType
          ) {
            return false;
          }

          if (
            filters.historyId !== "todos" &&
            movement.visibleId !== filters.historyId
          ) {
            return false;
          }

          if (
            filters.historyKg !== "todos" &&
            String(movement.kilos) !== filters.historyKg
          ) {
            return false;
          }

          return true;
        })
        .sort((a, b) => {
          const aValue = getMovementDate(a)?.getTime() ?? 0;
          const bValue = getMovementDate(b)?.getTime() ?? 0;
          return bValue - aValue;
        }),
    [
      clientScopedMovements,
      filters.historyId,
      filters.historyKg,
      filters.movementType,
      scopedMovements,
      showAllClientsHistory,
    ],
  );
  const totalPages = Math.max(
    1,
    Math.ceil(historyRecords.length / REGISTROS_POR_PAGINA),
  );
  const visibleHistory = historyRecords.slice(
    (currentPage - 1) * REGISTROS_POR_PAGINA,
    currentPage * REGISTROS_POR_PAGINA,
  );

  useEffect(() => {
    setCurrentPage(1);
    setExpandedHistoryId(null);
  }, [
    filters.historyId,
    filters.historyKg,
    filters.movementType,
    resolvedSelectedCampaignId,
    scopedFilters.from,
    scopedFilters.to,
    search,
    selectedClient,
    showAllClientsHistory,
  ]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (
      filters.historyId !== "todos" &&
      !historyIdOptions.includes(filters.historyId)
    ) {
      setFilters((currentValue) => ({ ...currentValue, historyId: "todos" }));
    }
  }, [filters.historyId, historyIdOptions]);

  useEffect(() => {
    if (
      filters.historyKg !== "todos" &&
      !historyKgOptions.includes(filters.historyKg)
    ) {
      setFilters((currentValue) => ({ ...currentValue, historyKg: "todos" }));
    }
  }, [filters.historyKg, historyKgOptions]);

  function cycleClient(direction: -1 | 1) {
    if (availableClients.length === 0) {
      return;
    }

    const currentIndex = Math.max(0, availableClients.indexOf(selectedClient));
    const nextIndex =
      (currentIndex + direction + availableClients.length) %
      availableClients.length;
    setSelectedClient(availableClients[nextIndex] ?? "");
  }

  function handleEditMovement(movement: EnvasesLedgerHistoryRecord) {
    if (isManualEditable(movement)) {
      setEditingMovement(movement);
      return;
    }

    const href = buildOriginModuleHref(movement, "edit");

    if (!href) {
      setFeedback({
        tone: "error",
        message:
          "No se encontro el registro de origen para editar este movimiento.",
      });
      return;
    }

    router.push(href);
  }

  async function handleDeleteMovement(movement: EnvasesLedgerHistoryRecord) {
    if (!isManualEditable(movement)) {
      const href = buildOriginModuleHref(movement, "delete");

      if (!href) {
        setFeedback({
          tone: "error",
          message:
            "No se encontro el registro de origen para eliminar este movimiento.",
        });
        return;
      }

      router.push(href);
      return;
    }

    const confirmed = window.confirm(
      `Va a eliminar el movimiento ${movementTypeLabel(movement)} del ${formatDisplayDate(
        getMovementDate(movement),
      )}.`,
    );

    if (!confirmed) {
      return;
    }

    setPendingMovementId(movement.id);
    setFeedback(null);

    try {
      const response = await fetchWithFirebaseAuth("/api/envases", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movimientoId: movement.id }),
      });
      const result = (await response.json()) as ActionState<ManualMutationData>;

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
            : "No fue posible eliminar el movimiento.",
      });
    } finally {
      setPendingMovementId(null);
    }
  }

  return (
    <ConsoleShell
      active="envases"
      firestoreDisponible={firestoreDisponible}
      footerHint="Libro contable derivado de envases: stock de planta, cuenta por cliente, saldo y trazabilidad historica."
      footerLabel="Envases"
    >
      <div className="grid gap-6">
        <section className="aether-panel rounded-2xl px-4 py-4 md:px-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="font-display text-2xl font-bold text-[var(--text)]">
                  Envases
                </h1>
                <ModuleLoadingIndicator isLoading={isLoading} />
              </div>
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                Stock de General de Envases, seguimiento de ingresos, egresos y
                bajas.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <ModuleSearchBox
                onChange={setSearch}
                placeholder="Buscar cliente, carga, envase o CP"
                suggestions={searchSuggestions}
                value={search}
              />
              <button
                className="console-secondary-button rounded-xl px-4 py-3 text-xs font-bold"
                onClick={() => {
                  setEditingMovement(null);
                  setIsIngresoModalOpen(true);
                }}
                type="button"
              >
                Ingreso manual
              </button>
              <button
                className="primary-action-button rounded-xl px-4 py-3 text-xs font-black text-[var(--primary-ink)]"
                onClick={() => {
                  setEditingMovement(null);
                  setIsBajaModalOpen(true);
                }}
                type="button"
              >
                Baja / Retiro
              </button>
            </div>
          </div>
        </section>

        {loadError ? (
          <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 ring-1 ring-red-100">
            {loadError}
          </div>
        ) : null}
        {feedback ? (
          <div
            className={`rounded-2xl px-4 py-3 text-sm font-semibold ring-1 ${feedback.tone === "success" ? "bg-emerald-50 text-emerald-800 ring-emerald-100" : "bg-red-50 text-red-800 ring-red-100"}`}
          >
            {feedback.message}
          </div>
        ) : null}

        <section className="grid gap-4">
          <div>
            <p className="font-display text-xl font-bold text-[var(--text)]">
              Stock total de la planta
            </p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Vista del Stock Total de Envases según Kg.
            </p>
          </div>
          <div className="aether-panel rounded-2xl px-4 py-5 md:px-5">
            <div className="overflow-x-auto pb-2">
              <div className="flex min-w-max gap-4">
                {stockPlanta.length > 0 ? (
                  stockPlanta.map((group) => (
                    <PlantStockCard group={group} key={group.kg} />
                  ))
                ) : (
                  <div className="aether-panel-soft min-w-full rounded-2xl px-4 py-5 text-sm font-semibold text-[var(--text-muted)]">
                    No hay stock general visible para los envases registrados.
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4">
          <div>
            <p className="font-display text-xl font-bold text-[var(--text)]">
              Cuenta de Envases
            </p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {selectedClient
                ? `Cuenta operativa de ${selectedClient} segmentada por kg.`
                : "Seleccione un cliente para analizar sus ingresos, consumos y bajas."}
            </p>
          </div>
          <div className="grid gap-4 xl:grid-cols-[280px_220px]">
            <ClientSelectorCard
              currentClientLabel={selectedClient || "Sin clientes"}
              disabled={availableClients.length === 0}
              onNext={() => cycleClient(1)}
              onPrev={() => cycleClient(-1)}
            />
            <div className="aether-panel-soft rounded-2xl px-4 py-4">
              <CampaignSelectorCard
                campaigns={campaigns}
                onChange={setSelectedCampaignId}
                selectedCampaignId={resolvedSelectedCampaignId}
              />
            </div>
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.9fr)]">
            <div className="grid gap-4 md:grid-cols-2">
              {accountGroups.length > 0 ? (
                accountGroups.map((group) => (
                  <ClientAccountCard
                    activeTab={activeAccountTab}
                    group={group}
                    key={group.kg}
                    onChangeTab={setActiveAccountTab}
                    onOpenDetail={(tab, item) =>
                      setDetailState({ client: selectedClient, item, tab })
                    }
                  />
                ))
              ) : (
                <div className="aether-panel-soft rounded-2xl px-4 py-5 text-sm font-semibold text-[var(--text-muted)]">
                  No hay movimientos contables visibles para el cliente y
                  filtros actuales.
                </div>
              )}
            </div>
            <section className="aether-panel rounded-2xl px-4 py-5 md:px-5">
              <div>
                <p className="font-display text-xl font-bold text-[var(--text)]">
                  Saldo General de Envases
                </p>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  Ingresos, consumos, bajas y saldo final de envases por
                  cliente.
                </p>
              </div>
              <div className="mt-4 overflow-x-auto rounded-2xl border border-[var(--line)]">
                <div className="min-w-[620px]">
                  <div className="grid gap-3 bg-[var(--surface-low)] px-4 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)] grid-cols-[minmax(0,1.6fr)_88px_88px_88px_96px] md:grid-cols-[minmax(0,1.6fr)_110px_110px_110px_110px]">
                    <span>ID contable</span>
                    <span className="text-center">Ingresos</span>
                    <span className="text-center">Consumos</span>
                    <span className="text-center">Bajas</span>
                    <span className="text-right">Saldo</span>
                  </div>
                  <div className="grid divide-y divide-[var(--line)]">
                    {balanceRows.length > 0 ? (
                      balanceRows.map((row) => (
                        <div
                          className={`grid gap-3 px-4 py-3 text-sm grid-cols-[minmax(0,1.6fr)_88px_88px_88px_96px] md:grid-cols-[minmax(0,1.6fr)_110px_110px_110px_110px] ${row.saldo >= 0 ? "bg-[var(--env-balance-positive-bg)] text-[var(--env-balance-positive-text)]" : "bg-[var(--env-balance-negative-bg)] text-[var(--env-balance-negative-text)]"}`}
                          key={row.inventoryId}
                          title={row.saldo >= 0 ? "disponibles" : "a devolver"}
                        >
                          <span className="font-semibold">{row.visibleId}</span>
                          <span className="text-center">
                            {formatQuantity(row.ingresos)}
                          </span>
                          <span className="text-center">
                            {formatQuantity(row.consumos)}
                          </span>
                          <span className="text-center">
                            {formatQuantity(row.bajas)}
                          </span>
                          <span className="font-display font-bold text-right">
                            {formatQuantity(row.saldo)}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="px-4 py-4 text-sm font-semibold text-[var(--text-muted)]">
                        No hay saldo visible para el cliente seleccionado.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </section>

        <section className="aether-panel rounded-2xl px-4 py-5 md:px-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-display text-xl font-bold text-[var(--text)]">
                Registro historico
              </p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                {historyRecords.length} movimientos visibles.
              </p>
            </div>
            <label className="inline-flex items-center gap-3 text-sm font-semibold text-[var(--text-soft)]">
              <input
                checked={showAllClientsHistory}
                className="h-4 w-4 rounded border-[var(--line)] text-[var(--primary)]"
                onChange={(event) =>
                  setShowAllClientsHistory(event.target.checked)
                }
                type="checkbox"
              />
              Ver todos los clientes
            </label>
          </div>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-[var(--line)]">
            <div className="min-w-[720px]">
              <div className="grid grid-cols-[120px_100px_minmax(0,1fr)_96px_104px] gap-3 bg-[var(--surface-low)] px-4 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)] md:grid-cols-[150px_120px_minmax(0,1fr)_110px_120px]">
                <span>Movimiento</span>
                <span>Fecha</span>
                <span>ID</span>
                <span className="md:text-right">Cantidad</span>
                <span className="md:text-right">Acciones</span>
              </div>
              <div className="grid gap-3 px-4 py-4">
                {visibleHistory.length > 0 ? (
                  visibleHistory.map((movement) => (
                    <HistoryRow
                      expanded={expandedHistoryId === movement.id}
                      isPending={pendingMovementId === movement.id}
                      key={movement.id}
                      movement={movement}
                      onDelete={() => handleDeleteMovement(movement)}
                      onEdit={() => handleEditMovement(movement)}
                      onToggle={() =>
                        setExpandedHistoryId((currentValue) =>
                          currentValue === movement.id ? null : movement.id,
                        )
                      }
                    />
                  ))
                ) : (
                  <div className="rounded-2xl bg-[var(--surface-low)] px-4 py-5 text-sm font-semibold text-[var(--text-muted)]">
                    Todavia no hay movimientos visibles para la segmentacion
                    actual.
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_150px]">
            <ModuleFilterField label="Movimiento">
              <select
                className="aether-field h-10 py-2 text-sm"
                onChange={(event) =>
                  setFilters((currentValue) => ({
                    ...currentValue,
                    movementType: event.target.value,
                  }))
                }
                value={filters.movementType}
              >
                <option value="todos">Todos</option>
                <option value="ingreso">Ingresos</option>
                <option value="consumo_proceso">Proceso</option>
                <option value="consumo_egreso_manual">Egreso manual</option>
                <option value="baja">Bajas</option>
                <option value="retiro">Retiros</option>
                <option value="reproceso">Reprocesos</option>
              </select>
            </ModuleFilterField>
            <ModuleFilterField label="ID">
              <select
                className="aether-field h-10 py-2 text-sm"
                onChange={(event) =>
                  setFilters((currentValue) => ({
                    ...currentValue,
                    historyId: event.target.value,
                  }))
                }
                value={filters.historyId}
              >
                <option value="todos">Todos</option>
                {historyIdOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </ModuleFilterField>
            <ModuleFilterField label="Kg">
              <select
                className="aether-field h-10 py-2 text-sm"
                onChange={(event) =>
                  setFilters((currentValue) => ({
                    ...currentValue,
                    historyKg: event.target.value,
                  }))
                }
                value={filters.historyKg}
              >
                <option value="todos">Todos</option>
                {historyKgOptions.map((option) => (
                  <option key={option} value={option}>
                    {option} kg
                  </option>
                ))}
              </select>
            </ModuleFilterField>
          </div>
          <PaginationControls
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            totalPages={totalPages}
          />
        </section>
      </div>

      {detailState ? (
        <AccountMovementDetailModal
          client={detailState.client}
          item={detailState.item}
          onClose={() => setDetailState(null)}
          tab={detailState.tab}
        />
      ) : null}
      {isIngresoModalOpen ||
      editingMovement?.manualOrigin === "manual_ingreso" ? (
        <IngresoManualModal
          clientesDisponibles={availableClients}
          envases={envases}
          movementToEdit={
            editingMovement?.manualOrigin === "manual_ingreso"
              ? editingMovement
              : null
          }
          onClose={() => {
            setIsIngresoModalOpen(false);
            setEditingMovement(null);
          }}
          onSuccess={(message) => {
            setFeedback({ tone: "success", message });
            setIsIngresoModalOpen(false);
            setEditingMovement(null);
          }}
        />
      ) : null}
      {isBajaModalOpen ||
      editingMovement?.manualOrigin === "manual_baja" ||
      editingMovement?.manualOrigin === "manual_retiro" ? (
        <BajaRetiroModal
          clientesDisponibles={availableClients}
          movementToEdit={
            editingMovement?.manualOrigin === "manual_baja" ||
            editingMovement?.manualOrigin === "manual_retiro"
              ? editingMovement
              : null
          }
          onClose={() => {
            setIsBajaModalOpen(false);
            setEditingMovement(null);
          }}
          onSuccess={(message) => {
            setFeedback({ tone: "success", message });
            setIsBajaModalOpen(false);
            setEditingMovement(null);
          }}
          stockEntries={plantEntries}
        />
      ) : null}
    </ConsoleShell>
  );
}
