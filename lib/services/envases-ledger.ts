import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import {
  compactarEspacios,
  construirEnvaseInventoryId,
  normalizarTextoParaIndice,
  timestampLikeToDate,
} from "@/lib/utils";
import {
  COLLECTIONS,
  descargaLegacySchema,
  envaseHistorialMovimientoSchema,
  operacionMercaderiaSchema,
  procesoRegistroSchema,
  type DescargaLegacy,
  type ProcesoRegistro,
  type ProcesoSalida,
} from "@/types/schema";

const ENVASES_LEDGER_READ_LIMIT = 500;

export type LedgerMovementKind =
  | "ingreso"
  | "consumo_proceso"
  | "consumo_egreso_manual"
  | "baja"
  | "retiro"
  | "reproceso";

export type DerivedEnvaseMovement = {
  id: string;
  sourceId: string;
  movementKind: LedgerMovementKind;
  recordOrigin: "descarga" | "carga" | "proceso" | "manual";
  manualOrigin: "manual_ingreso" | "manual_baja" | "manual_retiro" | null;
  cliente: string;
  envaseTipoId: string;
  envaseTipoCodigo: string;
  envaseTipoNombre: string;
  envaseEstado: string;
  inventoryId: string;
  visibleId: string;
  kilos: number;
  cantidad: number;
  deltaPlant: number;
  deltaClientBalance: number;
  consumptionDelta: number;
  fechaMovimiento: Date | null;
  createdAt: Date | null;
  producto?: string | null;
  proceso?: string | null;
  procedencia?: string | null;
  observaciones?: string | null;
  causa?: string | null;
  registroLabel: string;
  referenciaLabel?: string | null;
};

export type PlantStockEntry = {
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

export type PlantStockGroup = {
  kg: number;
  totalCantidad: number;
  totalRegistros: number;
  entries: PlantStockEntry[];
};

function getNumericValue(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = data[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number(value);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
}

function buildVisibleId(nombre: string, estado: string, kilos: number) {
  return `${nombre} | ${estado} | ${kilos} kg`;
}

function buildMovementBase(params: {
  id: string;
  sourceId: string;
  movementKind: LedgerMovementKind;
  cliente: string;
  envaseTipoId: string;
  envaseTipoCodigo: string;
  envaseTipoNombre: string;
  envaseEstado: string;
  kilos: number;
  cantidad: number;
  fechaMovimiento: Date | null;
  createdAt: Date | null;
  recordOrigin: "descarga" | "carga" | "proceso" | "manual";
  manualOrigin?: "manual_ingreso" | "manual_baja" | "manual_retiro" | null;
  producto?: string | null;
  proceso?: string | null;
  procedencia?: string | null;
  observaciones?: string | null;
  causa?: string | null;
  registroLabel: string;
  referenciaLabel?: string | null;
}) {
  const inventoryId = construirEnvaseInventoryId(
    params.envaseTipoId,
    params.envaseEstado,
    params.kilos,
  );
  const isIngreso = params.movementKind === "ingreso";
  const isBajaLike =
    params.movementKind === "baja" || params.movementKind === "retiro";
  const isReprocess = params.movementKind === "reproceso";

  return {
    ...params,
    manualOrigin: params.manualOrigin ?? null,
    inventoryId,
    visibleId: buildVisibleId(params.envaseTipoNombre, params.envaseEstado, params.kilos),
    deltaPlant: isIngreso ? params.cantidad : isReprocess ? params.cantidad : -params.cantidad,
    deltaClientBalance: isIngreso
      ? params.cantidad
      : isReprocess
        ? params.cantidad
        : -params.cantidad,
    consumptionDelta:
      params.movementKind === "consumo_proceso" ||
      params.movementKind === "consumo_egreso_manual"
        ? params.cantidad
        : isReprocess
          ? -params.cantidad
          : 0,
    causa: isBajaLike ? params.causa ?? null : null,
    referenciaLabel: params.referenciaLabel ?? null,
  } satisfies DerivedEnvaseMovement;
}

function summarizeLegacyPackagingMovements(
  packagingMovements: DescargaLegacy["packagingMovements"],
) {
  const movements = packagingMovements.flatMap((movement, index) => {
    const cantidad = getNumericValue(movement, [
      "quantity",
      "qty",
      "count",
      "units",
      "bags",
      "bultos",
    ]);

    if (cantidad <= 0) {
      return [];
    }

    return [
      {
        idSuffix: index + 1,
        cantidad,
        estado: compactarEspacios(movement.packagingCondition || "SIN DETALLE"),
        kilos: getNumericValue(movement, ["packagingKg", "kilos", "kg", "weightKg"]),
        tipo: compactarEspacios(movement.packagingType || "SIN DETALLE"),
      },
    ];
  });

  if (movements.length > 0) {
    return movements;
  }

  return [];
}

function getProcesoCantidadEnvases(
  salida: ProcesoSalida,
  record: ProcesoRegistro,
) {
  if (typeof salida.cantidadEnvases === "number" && Number.isFinite(salida.cantidadEnvases)) {
    return salida.cantidadEnvases;
  }

  if (record.salidas.length <= 1 && (record.envaseCantidad ?? 0) > 0) {
    return record.envaseCantidad;
  }

  return salida.envaseTipoId ? 1 : 0;
}

function mapDescargaDocument(
  id: string,
  data: FirebaseFirestore.DocumentData,
): DerivedEnvaseMovement[] {
  const parsed = operacionMercaderiaSchema.safeParse(data);

  if (parsed.success) {
    if (parsed.data.tipoOperacion !== "ingreso") {
      return [];
    }

    const detalle =
      parsed.data.detalleEnvases && parsed.data.detalleEnvases.length > 0
        ? parsed.data.detalleEnvases
        : [];

    return detalle
      .filter((item) => Number(item.cantidad ?? 0) > 0)
      .map((item, index) =>
        buildMovementBase({
          id: `descarga-${id}-${index + 1}`,
          sourceId: id,
          movementKind: "ingreso",
          cliente: parsed.data.cliente,
          envaseTipoId: item.envaseTipoId,
          envaseTipoCodigo: item.envaseTipoCodigo,
          envaseTipoNombre: item.envaseTipoNombre,
          envaseEstado: item.envaseEstado,
          kilos: item.kilos,
      cantidad: item.cantidad,
      fechaMovimiento: timestampLikeToDate(parsed.data.fechaOperacion),
      createdAt: timestampLikeToDate(parsed.data.createdAt),
      recordOrigin: "descarga",
      manualOrigin: null,
      producto: parsed.data.producto ?? null,
          proceso: parsed.data.proceso ?? null,
          procedencia: parsed.data.procedencia || parsed.data.proveedor || null,
          observaciones: parsed.data.observaciones ?? null,
          registroLabel: "Descarga",
          referenciaLabel: compactarEspacios(parsed.data.numeroCartaPorte ?? "") || null,
        }),
      );
  }

  const legacyParsed = descargaLegacySchema.safeParse(data);

  if (!legacyParsed.success) {
    return [];
  }

  return summarizeLegacyPackagingMovements(legacyParsed.data.packagingMovements).map(
    (movement) =>
      buildMovementBase({
        id: `descarga-${id}-${movement.idSuffix}`,
        sourceId: id,
        movementKind: "ingreso",
        cliente: legacyParsed.data.client,
        envaseTipoId: "legacy-packaging",
        envaseTipoCodigo: "PACK",
        envaseTipoNombre: movement.tipo,
        envaseEstado: movement.estado,
        kilos: movement.kilos,
        cantidad: movement.cantidad,
        fechaMovimiento: timestampLikeToDate(legacyParsed.data.entryDate),
        createdAt: timestampLikeToDate(legacyParsed.data.createdAt ?? legacyParsed.data.entryDate),
        recordOrigin: "descarga",
        manualOrigin: null,
        producto: legacyParsed.data.product,
        proceso: legacyParsed.data.processCode,
        procedencia: legacyParsed.data.supplier,
        observaciones: legacyParsed.data.observations ?? null,
        registroLabel: "Descarga",
        referenciaLabel:
          compactarEspacios(
            typeof data.numeroCartaPorte === "string" ? data.numeroCartaPorte : "",
          ) ||
          compactarEspacios(legacyParsed.data.id ?? "") ||
          null,
      }),
  );
}

function mapCargaDocument(
  id: string,
  data: FirebaseFirestore.DocumentData,
): DerivedEnvaseMovement[] {
  const parsed = operacionMercaderiaSchema.safeParse(data);

  if (!parsed.success || parsed.data.tipoOperacion !== "egreso") {
    return [];
  }

  const envaseMode =
    typeof data.envaseMode === "string"
      ? data.envaseMode
      : (parsed.data.loteEnvasadoDetalles?.length ?? 0) > 0
        ? "envasados"
        : (parsed.data.detalleEnvases?.length ?? 0) > 0
          ? "manual"
          : "granel";

  if (envaseMode === "granel") {
    return (parsed.data.loteEnvasadoDetalles ?? [])
      .filter((item) => Number(item.cantidad ?? 0) > 0)
      .map((item, index) =>
        buildMovementBase({
          id: `carga-granel-${id}-${index + 1}`,
          sourceId: id,
          movementKind: "reproceso",
          cliente: parsed.data.cliente,
          envaseTipoId: item.envaseTipoId,
          envaseTipoCodigo: item.envaseTipoId.toUpperCase().slice(0, 32),
          envaseTipoNombre: item.envaseTipoNombre,
          envaseEstado: item.envaseEstado,
          kilos: item.pesoEnvaseKg,
          cantidad: item.cantidad,
          fechaMovimiento: timestampLikeToDate(parsed.data.fechaOperacion),
          createdAt: timestampLikeToDate(parsed.data.createdAt),
          recordOrigin: "carga",
          manualOrigin: null,
          producto: parsed.data.producto ?? item.producto ?? null,
          proceso: parsed.data.proceso ?? item.proceso ?? null,
          procedencia:
            parsed.data.procedencia || parsed.data.proveedor || item.procedencia || null,
          observaciones: parsed.data.observaciones ?? null,
          registroLabel: "Granel",
          referenciaLabel:
            compactarEspacios(parsed.data.numeroCartaPorte ?? "") || "Devolucion a planta",
        }),
      );
  }

  if (envaseMode !== "manual") {
    return [];
  }

  return (parsed.data.detalleEnvases ?? [])
    .filter((item) => Number(item.cantidad ?? 0) > 0)
    .map((item, index) =>
      buildMovementBase({
        id: `carga-${id}-${index + 1}`,
        sourceId: id,
        movementKind: "consumo_egreso_manual",
        cliente: parsed.data.cliente,
        envaseTipoId: item.envaseTipoId,
        envaseTipoCodigo: item.envaseTipoCodigo,
        envaseTipoNombre: item.envaseTipoNombre,
        envaseEstado: item.envaseEstado,
        kilos: item.kilos,
        cantidad: item.cantidad,
        fechaMovimiento: timestampLikeToDate(parsed.data.fechaOperacion),
        createdAt: timestampLikeToDate(parsed.data.createdAt),
        recordOrigin: "carga",
        manualOrigin: null,
        producto: parsed.data.producto ?? null,
        proceso: parsed.data.proceso ?? null,
        procedencia: parsed.data.procedencia || parsed.data.proveedor || null,
        observaciones: parsed.data.observaciones ?? null,
        registroLabel: "Egreso manual",
        referenciaLabel:
          compactarEspacios(parsed.data.numeroCartaPorte ?? "") || "Egreso manual",
      }),
    );
}

function mapProcesoDocument(
  id: string,
  data: FirebaseFirestore.DocumentData,
): DerivedEnvaseMovement[] {
  const parsed = procesoRegistroSchema.safeParse(data);

  if (!parsed.success) {
    return [];
  }

  const salidas =
    parsed.data.salidas && parsed.data.salidas.length > 0
      ? parsed.data.salidas
      : parsed.data.envaseTipoId && parsed.data.envaseCantidad > 0
        ? [
            {
              id: `legacy-${id}`,
              grado:
                (parsed.data.tipoProceso === "descarte"
                  ? "no_recuperable"
                  : "exportacion") as ProcesoSalida["grado"],
              detalle:
                parsed.data.tipoProceso === "descarte" ? "Rechazo" : "Procesado",
              kilos:
                parsed.data.envaseKilos > 0
                  ? parsed.data.envaseKilos
                  : parsed.data.kilos,
              cantidadEnvases: parsed.data.envaseCantidad,
              envaseTipoId: parsed.data.envaseTipoId,
              inventoryId: "",
              envaseEstado: parsed.data.envaseEstado,
              envaseKilos: parsed.data.envaseKilos,
              envaseVisibleId: "",
              envaseTipoCodigo: parsed.data.envaseTipoCodigo,
              envaseTipoNombre: parsed.data.envaseTipoNombre,
              estadoAlmacenamiento: "activo" as const,
            },
          ]
        : [];

  return salidas.flatMap((salida, index) => {
    if (!salida.envaseTipoId) {
      return [];
    }

    const cantidad = getProcesoCantidadEnvases(salida, parsed.data);

    if (cantidad <= 0) {
      return [];
    }

    const envaseEstado =
      compactarEspacios(salida.envaseEstado ?? "") ||
      compactarEspacios(parsed.data.envaseEstado ?? "") ||
      (salida.grado === "no_recuperable"
        ? "No recuperable"
        : salida.grado === "recupero"
          ? "Recupero"
          : "Exportacion");
    const envaseKilos =
      Number(salida.envaseKilos ?? 0) > 0
        ? Number(salida.envaseKilos ?? 0)
        : parsed.data.envaseKilos > 0
          ? parsed.data.envaseKilos
          : 0;
    const base = buildMovementBase({
      id: `proceso-${id}-${salida.id || index + 1}`,
      sourceId: id,
      movementKind: "consumo_proceso",
      cliente: parsed.data.cliente,
      envaseTipoId: salida.envaseTipoId,
      envaseTipoCodigo: salida.envaseTipoCodigo,
      envaseTipoNombre: salida.envaseTipoNombre,
      envaseEstado,
      kilos: envaseKilos,
      cantidad,
      fechaMovimiento: timestampLikeToDate(parsed.data.fechaProceso),
      createdAt: timestampLikeToDate(parsed.data.createdAt),
      recordOrigin: "proceso",
      manualOrigin: null,
      producto: parsed.data.producto || null,
      proceso: parsed.data.proceso || parsed.data.numeroProceso || null,
      procedencia: parsed.data.procedencia || parsed.data.proveedor || null,
      observaciones: salida.detalle || parsed.data.observaciones || null,
      registroLabel:
        parsed.data.tipoOrden === "reprocesado" ? "Reproceso" : "Proceso",
      referenciaLabel:
        parsed.data.tipoOrden === "reprocesado" ? "Reproceso" : "Proceso",
    });

    if (salida.estadoAlmacenamiento === "reprocesado") {
      return [
        base,
        buildMovementBase({
          ...base,
          id: `${base.id}-reprocess`,
          movementKind: "reproceso",
          fechaMovimiento: timestampLikeToDate(salida.reprocessedAt) ?? base.fechaMovimiento,
          createdAt: timestampLikeToDate(salida.reprocessedAt) ?? base.createdAt,
          registroLabel: "Reproceso",
        }),
      ];
    }

    return [base];
  });
}

function mapManualMovimientoDocument(
  id: string,
  data: FirebaseFirestore.DocumentData,
): DerivedEnvaseMovement[] {
  const parsed = envaseHistorialMovimientoSchema.safeParse(data);

  if (!parsed.success) {
    return [];
  }

  const movementKind: LedgerMovementKind =
    parsed.data.tipoMovimiento === "retiro" || parsed.data.origen === "manual_retiro"
      ? "retiro"
      : parsed.data.tipoMovimiento === "ingreso"
        ? "ingreso"
        : "baja";

  return [
    buildMovementBase({
      id,
      sourceId: parsed.data.sourceId || id,
      movementKind,
      cliente: parsed.data.cliente,
      envaseTipoId: parsed.data.envaseTipoId,
      envaseTipoCodigo: parsed.data.envaseTipoCodigo,
      envaseTipoNombre: parsed.data.envaseTipoNombre,
      envaseEstado: parsed.data.envaseEstado,
      kilos: parsed.data.kilos,
      cantidad: parsed.data.cantidad,
      fechaMovimiento: timestampLikeToDate(parsed.data.fechaMovimiento),
      createdAt: timestampLikeToDate(parsed.data.createdAt),
      recordOrigin: "manual",
      manualOrigin:
        parsed.data.origen === "manual_retiro"
          ? "manual_retiro"
          : parsed.data.origen === "manual_baja"
            ? "manual_baja"
            : "manual_ingreso",
      observaciones: parsed.data.observaciones ?? null,
      causa: parsed.data.causa ?? null,
      registroLabel:
        movementKind === "ingreso"
          ? "Ingreso manual"
          : movementKind === "retiro"
            ? "Retiro"
            : "Baja",
      referenciaLabel:
        movementKind === "ingreso"
          ? "Ingreso manual"
          : parsed.data.causa ?? null,
    }),
  ];
}

export function summarizePlantStock(movements: DerivedEnvaseMovement[]): PlantStockGroup[] {
  const stockByInventory = new Map<string, PlantStockEntry>();

  for (const movement of movements) {
    const current = stockByInventory.get(movement.inventoryId) ?? {
      inventoryId: movement.inventoryId,
      visibleId: movement.visibleId,
      envaseTipoId: movement.envaseTipoId,
      envaseTipoCodigo: movement.envaseTipoCodigo,
      envaseTipoNombre: movement.envaseTipoNombre,
      envaseEstado: movement.envaseEstado,
      kilos: movement.kilos,
      cantidad: 0,
      transactionCount: 0,
    };

    current.cantidad += movement.deltaPlant;
    current.transactionCount += 1;
    stockByInventory.set(movement.inventoryId, current);
  }

  const groups = new Map<number, PlantStockGroup>();

  for (const entry of stockByInventory.values()) {
    if (entry.cantidad <= 0) {
      continue;
    }

    const currentGroup = groups.get(entry.kilos) ?? {
      kg: entry.kilos,
      totalCantidad: 0,
      totalRegistros: 0,
      entries: [],
    };

    currentGroup.entries.push(entry);
    currentGroup.totalCantidad += entry.cantidad;
    currentGroup.totalRegistros += entry.transactionCount;
    groups.set(entry.kilos, currentGroup);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      entries: group.entries.sort((a, b) => a.visibleId.localeCompare(b.visibleId, "es")),
    }))
    .sort((a, b) => b.kg - a.kg);
}

export async function getEnvasesLedgerSnapshot() {
  const db = getAdminDb();
  const [descargasSnap, cargasSnap, procesosSnap, manualSnap] = await Promise.all([
    db.collection(COLLECTIONS.descargas).orderBy("createdAt", "desc").limit(ENVASES_LEDGER_READ_LIMIT).get(),
    db.collection(COLLECTIONS.cargas).orderBy("createdAt", "desc").limit(ENVASES_LEDGER_READ_LIMIT).get(),
    db.collection(COLLECTIONS.procesos).orderBy("fechaProceso", "desc").limit(ENVASES_LEDGER_READ_LIMIT).get(),
    db.collection(COLLECTIONS.envaseMovimientos).orderBy("fechaMovimiento", "desc").limit(ENVASES_LEDGER_READ_LIMIT).get(),
  ]);

  const movements = [
    ...descargasSnap.docs.flatMap((documento) => mapDescargaDocument(documento.id, documento.data())),
    ...cargasSnap.docs.flatMap((documento) => mapCargaDocument(documento.id, documento.data())),
    ...procesosSnap.docs.flatMap((documento) => mapProcesoDocument(documento.id, documento.data())),
    ...manualSnap.docs.flatMap((documento) => mapManualMovimientoDocument(documento.id, documento.data())),
  ].sort((a, b) => {
    const aValue = a.fechaMovimiento?.getTime() ?? a.createdAt?.getTime() ?? 0;
    const bValue = b.fechaMovimiento?.getTime() ?? b.createdAt?.getTime() ?? 0;
    return bValue - aValue;
  });

  const clientesDisponibles = [...new Set(movements.map((movement) => movement.cliente))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "es"));

  return {
    clientesDisponibles,
    movimientos: movements,
    stockPlanta: summarizePlantStock(movements),
  };
}

export async function getPlantStockAvailabilityMap() {
  const snapshot = await getEnvasesLedgerSnapshot();
  const availability = new Map<string, PlantStockEntry>();

  for (const group of snapshot.stockPlanta) {
    for (const entry of group.entries) {
      availability.set(entry.inventoryId, entry);
    }
  }

  return availability;
}

export function getInventoryIdForDetail(detail: {
  envaseTipoId: string;
  envaseEstado: string;
  kilos: number;
}) {
  return construirEnvaseInventoryId(detail.envaseTipoId, detail.envaseEstado, detail.kilos);
}

export function getClientKey(cliente: string) {
  return normalizarTextoParaIndice(compactarEspacios(cliente));
}
