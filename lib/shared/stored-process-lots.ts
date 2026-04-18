import {
  compactarEspacios,
  construirEnvaseInventoryId,
} from "@/lib/utils";
import type {
  GradoSalidaProceso,
  EstadoAlmacenamientoProceso,
  ModoEnvasesOperacion,
  TipoOrdenProceso,
} from "@/types/schema";

type StoredLotProcessSalida = {
  id?: string;
  grado: GradoSalidaProceso;
  detalle: string;
  kilos: number;
  cantidadEnvases?: number;
  envaseTipoId?: string;
  envaseTipoNombre?: string;
  envaseEstado?: string;
  envaseKilos?: number;
  envaseVisibleId?: string;
  estadoAlmacenamiento?: EstadoAlmacenamientoProceso;
};

export type StoredLotProcessRecord = {
  id: string;
  fechaProceso: Date | null;
  cliente: string;
  proceso: string;
  producto?: string | null;
  procedencia?: string | null;
  proveedor?: string | null;
  tipoOrden: TipoOrdenProceso;
  salidas: StoredLotProcessSalida[];
};

export type StoredLotDispatchDetail = {
  storedItemId: string;
  procesoId: string;
  salidaId: string;
  cantidad: number;
  kilos: number;
};

export type StoredLotDispatchRecord = {
  id: string;
  envaseMode?: ModoEnvasesOperacion | null;
  loteEnvasadoDetalles?: StoredLotDispatchDetail[] | null;
};

export type StoredProcessLot = {
  id: string;
  storedItemId: string;
  procesoId: string;
  salidaId: string;
  fechaProceso: Date | null;
  cliente: string;
  proceso: string;
  producto: string;
  procedencia: string;
  grado: GradoSalidaProceso;
  detalle: string;
  kilosTotal: number;
  kilosDisponibles: number;
  cantidadTotal: number;
  cantidadDisponible: number;
  envaseTipoId: string;
  envaseTipoNombre: string;
  envaseEstado: string;
  envaseVisibleId: string;
  inventoryId: string;
  pesoEnvaseKg: number;
  tipoOrden: TipoOrdenProceso;
};

function getCantidadEnvases(salida: StoredLotProcessSalida) {
  if (
    typeof salida.cantidadEnvases === "number" &&
    Number.isFinite(salida.cantidadEnvases) &&
    salida.cantidadEnvases > 0
  ) {
    return salida.cantidadEnvases;
  }

  return compactarEspacios(salida.envaseTipoId ?? "") ? 1 : 0;
}

function buildVisibleId(
  envaseTipoNombre: string,
  envaseEstado: string,
  pesoEnvaseKg: number,
) {
  return `${envaseTipoNombre} | ${envaseEstado} | ${pesoEnvaseKg} kg`;
}

function isDispatchableStoredGrade(grade: GradoSalidaProceso) {
  return (
    grade === "exportacion" ||
    grade === "recupero" ||
    grade === "no_recuperable"
  );
}

export function buildStoredProcessLots(
  processRecords: StoredLotProcessRecord[],
  dispatchRecords: StoredLotDispatchRecord[] = [],
) {
  const lots = new Map<string, StoredProcessLot>();

  for (const record of processRecords) {
    for (const salida of record.salidas) {
      const envaseTipoId = compactarEspacios(salida.envaseTipoId ?? "");

      if (
        salida.estadoAlmacenamiento !== "activo" ||
        !envaseTipoId ||
        !isDispatchableStoredGrade(salida.grado)
      ) {
        continue;
      }

      const salidaId = compactarEspacios(salida.id ?? "") || `${record.id}-salida`;
      const cantidadTotal = getCantidadEnvases(salida);
      const pesoEnvaseKg = Number(salida.envaseKilos ?? 0);
      const envaseEstado = compactarEspacios(salida.envaseEstado ?? "") || "Sin estado";
      const envaseTipoNombre =
        compactarEspacios(salida.envaseTipoNombre ?? "") || envaseTipoId;
      const envaseVisibleId =
        compactarEspacios(salida.envaseVisibleId ?? "") ||
        buildVisibleId(envaseTipoNombre, envaseEstado, pesoEnvaseKg);
      const inventoryId = construirEnvaseInventoryId(
        envaseTipoId,
        envaseEstado,
        pesoEnvaseKg,
      );
      const storedItemId = `${record.id}__${salidaId}`;

      lots.set(storedItemId, {
        id: storedItemId,
        storedItemId,
        procesoId: record.id,
        salidaId,
        fechaProceso: record.fechaProceso,
        cliente: compactarEspacios(record.cliente),
        proceso: compactarEspacios(record.proceso),
        producto: compactarEspacios(record.producto ?? "") || "Sin producto",
        procedencia:
          compactarEspacios(record.procedencia ?? record.proveedor ?? "") ||
          "Sin procedencia",
        grado: salida.grado,
        detalle: compactarEspacios(salida.detalle),
        kilosTotal: Number(salida.kilos ?? 0),
        kilosDisponibles: Number(salida.kilos ?? 0),
        cantidadTotal,
        cantidadDisponible: cantidadTotal,
        envaseTipoId,
        envaseTipoNombre,
        envaseEstado,
        envaseVisibleId,
        inventoryId,
        pesoEnvaseKg,
        tipoOrden: record.tipoOrden,
      });
    }
  }

  for (const dispatchRecord of dispatchRecords) {
    if (
      dispatchRecord.envaseMode !== "envasados" &&
      dispatchRecord.envaseMode !== "granel"
    ) {
      continue;
    }

    for (const detail of dispatchRecord.loteEnvasadoDetalles ?? []) {
      const lot = lots.get(detail.storedItemId);

      if (!lot) {
        continue;
      }

      lot.cantidadDisponible = Math.max(
        0,
        lot.cantidadDisponible - Number(detail.cantidad ?? 0),
      );
      lot.kilosDisponibles = Math.max(
        0,
        lot.kilosDisponibles - Number(detail.kilos ?? 0),
      );
    }
  }

  return [...lots.values()]
    .filter(
      (lot) => lot.cantidadDisponible > 0 && Number(lot.kilosDisponibles) > 0,
    )
    .sort((a, b) => {
      const aValue = a.fechaProceso?.getTime() ?? 0;
      const bValue = b.fechaProceso?.getTime() ?? 0;
      return bValue - aValue;
    });
}
