import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  getEnvasesLedgerSnapshot,
  getPlantStockAvailabilityMap,
  type DerivedEnvaseMovement,
  type PlantStockEntry,
  type PlantStockGroup,
} from "@/lib/services/envases-ledger";
import { getEnvasesOperativos, type EnvaseOption } from "@/lib/services/operaciones";
import {
  compactarEspacios,
  construirClavesFecha,
  construirEnvaseInventoryId,
  construirEnvaseInventoryIdCanonico,
  construirEnvaseTipoCodigoManual,
  construirEnvaseTipoIdManual,
  fechaIsoLocalToDate,
  normalizarTextoParaIndice,
  timestampLikeToDate
} from "@/lib/utils";
import {
  COLLECTIONS,
  descargaLegacySchema,
  envaseBajaFormSchema,
  envaseHistorialMovimientoSchema,
  envaseIngresoManualFormSchema,
  envaseLoteOcultoSchema,
  envaseMovimientoManualIdSchema,
  envaseSchema,
  envaseStockSchema,
  envaseTipoSchema,
  operacionMercaderiaSchema,
  procesoRegistroSchema,
  type ActionState,
  type Envase,
  type EnvaseBajaFormInput,
  type EnvaseHistorialMovimiento,
  type EnvaseIngresoManualFormInput,
  type EnvaseStock,
  type EnvaseTipo,
  type DescargaLegacy
} from "@/types/schema";

const DEFAULT_FIRESTORE_ACTOR =
  process.env.FIRESTORE_DEFAULT_ACTOR?.trim() || "audit-alta-system";
const ENVASES_DASHBOARD_READ_LIMIT = 400;

type EnvaseWriteModel = Pick<
  Envase,
  | "codigo"
  | "nombre"
  | "activo"
  | "controlaStock"
  | "descripcion"
  | "orden"
  | "stockActual"
  | "ingresosAcumulados"
  | "egresosAcumulados"
  | "ajustesAcumulados"
  | "version"
> & {
  id: string;
};

export type EnvaseHistoryRecord = Pick<
  EnvaseHistorialMovimiento,
  | "tipoMovimiento"
  | "origen"
  | "cliente"
  | "envaseTipoId"
  | "envaseTipoCodigo"
  | "envaseTipoNombre"
  | "envaseEstado"
  | "kilos"
  | "cantidad"
  | "inventoryId"
  | "transporte"
  | "causa"
  | "tipoProceso"
  | "observaciones"
  | "sourceId"
> & {
  id: string;
  fechaMovimiento: Date | null;
  createdAt: Date | null;
};

export type EnvasesDashboardData = {
  firestoreDisponible: boolean;
  envases: EnvaseOption[];
  clientesDisponibles: string[];
  stockPlanta: PlantStockGroup[];
  historialDerivado: DerivedEnvaseMovement[];
};

export type EnvasesLedgerHistoryRecord = DerivedEnvaseMovement;

export type CrearMovimientoEnvaseData = {
  movimientoId: string;
};

export type OcultarLoteEnvaseData = {
  loteId: string;
};

type InventorySnapshotRow = {
  key: string;
  sourceId: string;
  inventoryId: string;
  envaseTipoId: string;
  envaseTipoNombre: string;
  envaseEstado: string;
  cliente: string;
  kilos: number;
  cantidad: number;
  lastFecha: Date | null;
};

type ManualEditableMovement = EnvaseHistoryRecord & {
  origen: "manual_ingreso" | "manual_baja" | "manual_retiro";
};

function buildFallbackEnvaseWriteModel(
  envaseId: string,
  fallbackName: string,
  fallbackCode?: string
) {
  return {
    existsInNuevaColeccion: false,
    envase: {
      id: envaseId,
      codigo: fallbackCode || construirEnvaseTipoCodigoManual(fallbackName),
      nombre: fallbackName,
      descripcion: "Envase operativo detectado fuera del catalogo principal.",
      controlaStock: false,
      activo: true,
      orden: 999,
      stockActual: 0,
      ingresosAcumulados: 0,
      egresosAcumulados: 0,
      ajustesAcumulados: 0,
      version: 0
    }
  };
}

function buildHiddenLoteId(inventoryId: string, cliente: string) {
  return `${inventoryId}__${normalizarTextoParaIndice(cliente)}`;
}

function parseManualEnvaseHistory(
  id: string,
  data: FirebaseFirestore.DocumentData
): EnvaseHistoryRecord | null {
  const parsed = envaseHistorialMovimientoSchema.safeParse(data);

  if (!parsed.success) {
    return null;
  }

  return {
    id,
    tipoMovimiento: parsed.data.tipoMovimiento,
    origen: parsed.data.origen,
    cliente: parsed.data.cliente,
    envaseTipoId: parsed.data.envaseTipoId,
    envaseTipoCodigo: parsed.data.envaseTipoCodigo,
    envaseTipoNombre: parsed.data.envaseTipoNombre,
    envaseEstado: parsed.data.envaseEstado,
    kilos: parsed.data.kilos,
    cantidad: parsed.data.cantidad,
    inventoryId: construirEnvaseInventoryIdCanonico({
      envaseTipoId: parsed.data.envaseTipoId,
      envaseTipoCodigo: parsed.data.envaseTipoCodigo,
      envaseTipoNombre: parsed.data.envaseTipoNombre,
      envaseEstado: parsed.data.envaseEstado,
      kilos: parsed.data.kilos,
    }),
    transporte: parsed.data.transporte,
    causa: parsed.data.causa,
    tipoProceso: parsed.data.tipoProceso,
    observaciones: parsed.data.observaciones,
    sourceId: parsed.data.sourceId,
    fechaMovimiento: timestampLikeToDate(parsed.data.fechaMovimiento),
    createdAt: timestampLikeToDate(parsed.data.createdAt)
  };
}

function getNumericValue(
  data: Record<string, unknown>,
  keys: string[]
): number {
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

function summarizeLegacyPackagingMovements(
  packagingMovements: DescargaLegacy["packagingMovements"]
) {
  const packagingTypes = new Set<string>();
  const packagingConditions = new Set<string>();
  let quantity = 0;

  for (const movement of packagingMovements) {
    packagingTypes.add(movement.packagingType);
    packagingConditions.add(movement.packagingCondition);
    quantity += getNumericValue(movement, [
      "quantity",
      "qty",
      "count",
      "units",
      "bags",
      "bultos"
    ]);
  }

  return {
    quantity,
    packagingTypeLabel:
      packagingTypes.size > 0 ? [...packagingTypes].join(" / ") : "SIN DETALLE",
    packagingConditionLabel:
      packagingConditions.size > 0
        ? [...packagingConditions].join(" / ")
        : "SIN DETALLE"
  };
}

function mapOperacionDetalleEnvases(
  id: string,
  data: FirebaseFirestore.DocumentData
): EnvaseHistoryRecord[] {
  const parsed = operacionMercaderiaSchema.safeParse(data);

  if (parsed.success) {
    const transporte = [parsed.data.proveedor, parsed.data.procedencia]
      .filter(Boolean)
      .join(" / ");
    const details =
      parsed.data.detalleEnvases && parsed.data.detalleEnvases.length > 0
        ? parsed.data.detalleEnvases
        : parsed.data.cantidadEnvases <= 0
          ? []
        : [
            {
              envaseTipoId: parsed.data.envaseTipoId,
              envaseTipoCodigo: parsed.data.envaseTipoCodigo,
              envaseTipoNombre: parsed.data.envaseTipoNombre,
              envaseEstado: parsed.data.envaseEstado ?? "Conforme",
              kilos: parsed.data.kilos,
              cantidad: parsed.data.cantidadEnvases
            }
          ];

    return details.map((detail, index) => ({
      id: `descarga-${id}-${index + 1}`,
      tipoMovimiento: "ingreso",
      origen: "descarga",
      cliente: parsed.data.cliente,
      envaseTipoId: detail.envaseTipoId,
      envaseTipoCodigo: detail.envaseTipoCodigo,
      envaseTipoNombre: detail.envaseTipoNombre,
      envaseEstado: detail.envaseEstado,
      kilos: detail.kilos,
      cantidad: detail.cantidad,
      inventoryId: construirEnvaseInventoryId(
        detail.envaseTipoId,
        detail.envaseEstado,
        detail.kilos
      ),
      transporte: transporte || null,
      causa: null,
      tipoProceso: parsed.data.proceso ?? null,
      observaciones: parsed.data.observaciones,
      sourceId: id,
      fechaMovimiento: timestampLikeToDate(parsed.data.fechaOperacion),
      createdAt: timestampLikeToDate(parsed.data.createdAt)
    }));
  }

  const legacyParsed = descargaLegacySchema.safeParse(data);

  if (!legacyParsed.success) {
    return [];
  }

  const packagingSummary = summarizeLegacyPackagingMovements(
    legacyParsed.data.packagingMovements
  );

  if (legacyParsed.data.packagingMovements.length > 0) {
    return legacyParsed.data.packagingMovements.flatMap((movement, index) => {
      const cantidad = getNumericValue(movement, [
        "quantity",
        "qty",
        "count",
        "units",
        "bags",
        "bultos"
      ]);

      if (cantidad <= 0) {
        return [];
      }

      const envaseEstado = movement.packagingCondition || "SIN DETALLE";

      return [
        {
          id: `descarga-${id}-${index + 1}`,
          tipoMovimiento: "ingreso" as const,
          origen: "descarga" as const,
          cliente: legacyParsed.data.client,
          envaseTipoId: "legacy-packaging",
          envaseTipoCodigo: "PACK",
          envaseTipoNombre: movement.packagingType || "SIN DETALLE",
          envaseEstado,
          kilos: getNumericValue(movement, [
            "packagingKg",
            "kilos",
            "kg",
            "weightKg"
          ]),
          cantidad,
          inventoryId: construirEnvaseInventoryId(
            "legacy-packaging",
            envaseEstado,
            getNumericValue(movement, ["packagingKg", "kilos", "kg", "weightKg"])
          ),
          transporte: legacyParsed.data.truckPlate || null,
          causa: null,
          tipoProceso: legacyParsed.data.processCode,
          observaciones: legacyParsed.data.observations,
          sourceId: id,
          fechaMovimiento: timestampLikeToDate(legacyParsed.data.entryDate),
          createdAt: timestampLikeToDate(
            legacyParsed.data.createdAt ?? legacyParsed.data.entryDate
          )
        }
      ];
    });
  }

  if (packagingSummary.quantity <= 0) {
    return [];
  }

  const envaseEstado = packagingSummary.packagingConditionLabel;

  return [
    {
      id: `descarga-${id}-1`,
      tipoMovimiento: "ingreso",
      origen: "descarga",
      cliente: legacyParsed.data.client,
      envaseTipoId: "legacy-packaging",
      envaseTipoCodigo: "PACK",
      envaseTipoNombre: packagingSummary.packagingTypeLabel,
      envaseEstado,
      kilos: legacyParsed.data.netKg,
      cantidad: packagingSummary.quantity,
      inventoryId: construirEnvaseInventoryId(
        "legacy-packaging",
        envaseEstado,
        legacyParsed.data.netKg
      ),
      transporte: legacyParsed.data.truckPlate || null,
      causa: null,
      tipoProceso: legacyParsed.data.processCode,
      observaciones: legacyParsed.data.observations,
      sourceId: id,
      fechaMovimiento: timestampLikeToDate(legacyParsed.data.entryDate),
      createdAt: timestampLikeToDate(
        legacyParsed.data.createdAt ?? legacyParsed.data.entryDate
      )
    }
  ];
}

function mapOperacionToEnvaseHistory(
  id: string,
  data: FirebaseFirestore.DocumentData
) : EnvaseHistoryRecord[] {
  return mapOperacionDetalleEnvases(id, data);
}

function mapProcesoToEnvaseHistory(
  id: string,
  data: FirebaseFirestore.DocumentData
): EnvaseHistoryRecord[] {
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
                parsed.data.tipoProceso === "descarte"
                  ? "no_recuperable"
                  : "exportacion",
              detalle:
                parsed.data.tipoProceso === "descarte" ? "Rechazo" : "Procesado",
              kilos:
                parsed.data.envaseKilos > 0
                  ? parsed.data.envaseKilos
                  : parsed.data.kilos,
              envaseTipoId: parsed.data.envaseTipoId,
              envaseTipoCodigo: parsed.data.envaseTipoCodigo,
              envaseTipoNombre: parsed.data.envaseTipoNombre,
              estadoAlmacenamiento: "activo" as const,
            },
          ]
        : [];

  return salidas.flatMap((salida, index) => {
    if (
      !salida.envaseTipoId ||
      salida.estadoAlmacenamiento === "reprocesado" ||
      salida.kilos <= 0
    ) {
      return [];
    }

    const envaseEstado =
      salida.grado === "no_recuperable"
        ? "No recuperable"
        : salida.grado === "recupero"
          ? "Recupero"
          : "Exportacion";

    return [
      {
        id: `proceso-${id}-${salida.id || index + 1}`,
        tipoMovimiento: "envasado",
        origen: "proceso",
        cliente: parsed.data.cliente,
        envaseTipoId: salida.envaseTipoId,
        envaseTipoCodigo: salida.envaseTipoCodigo,
        envaseTipoNombre: salida.envaseTipoNombre,
        envaseEstado,
        kilos: salida.kilos,
        cantidad: 1,
        inventoryId: construirEnvaseInventoryId(
          salida.envaseTipoId,
          envaseEstado,
          salida.kilos
        ),
        transporte: null,
        causa: null,
        tipoProceso: parsed.data.tipoOrden ?? parsed.data.tipoProceso,
        observaciones: salida.detalle || parsed.data.observaciones,
        sourceId: id,
        fechaMovimiento: timestampLikeToDate(parsed.data.fechaProceso),
        createdAt: timestampLikeToDate(parsed.data.createdAt)
      },
    ];
  });
}

function mergeLegacyEnvaseForWrite(
  id: string,
  tipo: EnvaseTipo,
  stock: EnvaseStock | null
): EnvaseWriteModel {
  return {
    id,
    codigo: tipo.codigo,
    nombre: tipo.nombre,
    descripcion: tipo.descripcion,
    controlaStock: tipo.controlaStock !== false,
    activo: tipo.activo !== false,
    orden: tipo.orden ?? 0,
    stockActual: stock?.stockActual ?? 0,
    ingresosAcumulados: stock?.ingresosAcumulados ?? 0,
    egresosAcumulados: stock?.egresosAcumulados ?? 0,
    ajustesAcumulados: stock?.ajustesAcumulados ?? 0,
    version: stock?.version ?? 0
  };
}

function getEnvaseForWrite(
  envaseId: string,
  envaseSnap: FirebaseFirestore.DocumentSnapshot,
  legacyTipoSnap: FirebaseFirestore.DocumentSnapshot,
  legacyStockSnap: FirebaseFirestore.DocumentSnapshot,
  fallback?: {
    codigo?: string;
    nombre?: string;
  }
) {
  if (envaseSnap.exists) {
    const parsedEnvase = envaseSchema.safeParse(envaseSnap.data());

    if (parsedEnvase.success) {
      return {
        existsInNuevaColeccion: true,
        envase: {
          id: envaseId,
          ...parsedEnvase.data
        }
      };
    }
  }

  if (legacyTipoSnap.exists) {
    const parsedTipo = envaseTipoSchema.safeParse(legacyTipoSnap.data());
    const parsedStock = legacyStockSnap.exists
      ? envaseStockSchema.safeParse(legacyStockSnap.data())
      : null;

    if (parsedTipo.success) {
      return {
        existsInNuevaColeccion: false,
        envase: mergeLegacyEnvaseForWrite(
          envaseId,
          parsedTipo.data,
          parsedStock?.success ? parsedStock.data : null
        )
      };
    }
  }

  if (fallback?.nombre) {
    return buildFallbackEnvaseWriteModel(
      envaseId,
      compactarEspacios(fallback.nombre),
      fallback.codigo ? compactarEspacios(fallback.codigo) : undefined
    );
  }

  return null;
}

function getEditableManualMovement(
  id: string,
  data: FirebaseFirestore.DocumentData
): ManualEditableMovement {
  const parsed = parseManualEnvaseHistory(id, data);

  if (!parsed) {
    throw new Error("El movimiento seleccionado no tiene un formato valido.");
  }

  if (
    parsed.origen !== "manual_ingreso" &&
    parsed.origen !== "manual_baja" &&
    parsed.origen !== "manual_retiro"
  ) {
    throw new Error(
      "Solo se pueden editar o eliminar movimientos manuales de envases."
    );
  }

  return parsed as ManualEditableMovement;
}

async function resolveEnvaseResultForMovement(
  transaction: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  movimiento: {
    envaseTipoId: string;
    envaseTipoNombre: string;
    envaseTipoCodigo: string;
  }
) {
  const envaseRef = db.collection(COLLECTIONS.envases).doc(movimiento.envaseTipoId);
  const legacyTipoRef = db
    .collection(COLLECTIONS.envaseTipos)
    .doc(movimiento.envaseTipoId);
  const legacyStockRef = db
    .collection(COLLECTIONS.envaseStock)
    .doc(movimiento.envaseTipoId);
  const [envaseSnap, legacyTipoSnap, legacyStockSnap] = await Promise.all([
    transaction.get(envaseRef),
    transaction.get(legacyTipoRef),
    transaction.get(legacyStockRef)
  ]);
  const envaseResult = getEnvaseForWrite(
    movimiento.envaseTipoId,
    envaseSnap,
    legacyTipoSnap,
    legacyStockSnap,
    {
      codigo: movimiento.envaseTipoCodigo,
      nombre: movimiento.envaseTipoNombre
    }
  );

  if (!envaseResult) {
    throw new Error("El tipo de envase seleccionado no existe.");
  }

  return {
    envaseRef,
    envaseResult
  };
}

async function revertManualMovement(
  transaction: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  movimiento: ManualEditableMovement,
  actorId: string,
  now: FirebaseFirestore.Timestamp
) {
  const { envaseRef, envaseResult } = await resolveEnvaseResultForMovement(
    transaction,
    db,
    movimiento
  );

  if (envaseResult.envase.controlaStock === false) {
    return;
  }

  if (movimiento.origen === "manual_ingreso") {
    await syncEnvaseCounters(transaction, {
      envaseRef,
      envase: envaseResult.envase,
      existsInNuevaColeccion: envaseResult.existsInNuevaColeccion,
      now,
      movimientoId: movimiento.id,
      deltaStock: -movimiento.cantidad,
      deltaIngresos: -movimiento.cantidad,
      actorId
    });
    return;
  }

  await syncEnvaseCounters(transaction, {
    envaseRef,
    envase: envaseResult.envase,
    existsInNuevaColeccion: envaseResult.existsInNuevaColeccion,
    now,
    movimientoId: movimiento.id,
    deltaStock: movimiento.cantidad,
    deltaAjustes: -movimiento.cantidad,
    actorId
  });
}

async function syncEnvaseCounters(
  transaction: FirebaseFirestore.Transaction,
  params: {
    envaseRef: FirebaseFirestore.DocumentReference;
    envase: EnvaseWriteModel;
    existsInNuevaColeccion: boolean;
    now: FirebaseFirestore.Timestamp;
    movimientoId: string;
    deltaStock: number;
    deltaIngresos?: number;
    deltaAjustes?: number;
    actorId: string;
  }
) {
  const {
    envaseRef,
    envase,
    existsInNuevaColeccion,
    now,
    movimientoId,
    deltaStock,
    deltaIngresos = 0,
    deltaAjustes = 0,
    actorId
  } = params;

  if (existsInNuevaColeccion) {
    transaction.set(
      envaseRef,
      {
        stockActual: FieldValue.increment(deltaStock),
        ingresosAcumulados: FieldValue.increment(deltaIngresos),
        ajustesAcumulados: FieldValue.increment(deltaAjustes),
        updatedAt: now,
        updatedBy: actorId,
        lastMovimientoId: movimientoId,
        version: FieldValue.increment(1)
      },
      { merge: true }
    );
    return;
  }

  transaction.set(
    envaseRef,
    {
      codigo: envase.codigo,
      nombre: envase.nombre,
      descripcion: envase.descripcion ?? "",
      controlaStock: envase.controlaStock,
      activo: envase.activo,
      orden: envase.orden,
      stockActual: envase.stockActual + deltaStock,
      ingresosAcumulados: envase.ingresosAcumulados + deltaIngresos,
      egresosAcumulados: envase.egresosAcumulados,
      ajustesAcumulados: envase.ajustesAcumulados + deltaAjustes,
      createdAt: now,
      updatedAt: now,
      createdBy: actorId,
      updatedBy: actorId,
      lastMovimientoId: movimientoId,
      version: envase.version + 1
    },
    { merge: true }
  );
}

function buildInventoryRows(movimientos: EnvaseHistoryRecord[]): InventorySnapshotRow[] {
  const inventoryRows: InventorySnapshotRow[] = [];
  const sortedMovimientos = [...movimientos].sort((a, b) => {
    const aValue = a.fechaMovimiento?.getTime() ?? a.createdAt?.getTime() ?? 0;
    const bValue = b.fechaMovimiento?.getTime() ?? b.createdAt?.getTime() ?? 0;
    return aValue - bValue;
  });

  for (const movimiento of sortedMovimientos) {
    const clienteNormalizado = normalizarTextoParaIndice(movimiento.cliente);

    if (movimiento.tipoMovimiento !== "baja") {
      const sourceId = movimiento.id;
      const rowKey = `${movimiento.inventoryId}__${clienteNormalizado}__${sourceId}`;
      const currentValue = inventoryRows.find((row) => row.key === rowKey);

      if (currentValue) {
        currentValue.cantidad += movimiento.cantidad;
        currentValue.lastFecha = movimiento.fechaMovimiento;
        continue;
      }

      inventoryRows.push({
        key: rowKey,
        sourceId,
        inventoryId: movimiento.inventoryId,
        envaseTipoId: movimiento.envaseTipoId,
        envaseTipoNombre: movimiento.envaseTipoNombre,
        envaseEstado: movimiento.envaseEstado,
        cliente: movimiento.cliente,
        kilos: movimiento.kilos,
        cantidad: movimiento.cantidad,
        lastFecha: movimiento.fechaMovimiento
      });
      continue;
    }

    let remaining = movimiento.cantidad;
    const matchingRows = inventoryRows.filter(
      (row) =>
        row.inventoryId === movimiento.inventoryId &&
        normalizarTextoParaIndice(row.cliente) === clienteNormalizado
    );
    const targetedRows =
      movimiento.sourceId && movimiento.sourceId.trim().length > 0
        ? matchingRows.filter((row) => row.sourceId === movimiento.sourceId)
        : matchingRows;

    for (const row of targetedRows) {
      if (remaining <= 0) {
        break;
      }

      const descontado = Math.min(row.cantidad, remaining);
      row.cantidad -= descontado;
      row.lastFecha = movimiento.fechaMovimiento;
      remaining -= descontado;
    }
  }

  return inventoryRows;
}

async function upsertIngresoManualMovement(
  transaction: FirebaseFirestore.Transaction,
  params: {
    db: FirebaseFirestore.Firestore;
    movimientoRef: FirebaseFirestore.DocumentReference;
    input: EnvaseIngresoManualFormInput;
    actorId: string;
    now: FirebaseFirestore.Timestamp;
    createdAt?: FirebaseFirestore.Timestamp;
    createdBy?: string;
  }
) {
  const {
    db,
    movimientoRef,
    input,
    actorId,
    now,
    createdAt = now,
    createdBy = actorId
  } = params;
  const fechaKeys = construirClavesFecha(input.fechaMovimiento);
  const fechaMovimiento = Timestamp.fromDate(
    fechaIsoLocalToDate(input.fechaMovimiento)
  );
  const cliente = compactarEspacios(input.cliente);
  const envaseEstado = compactarEspacios(input.envaseEstado);
  const transporte = compactarEspacios(input.transporte);
  const observaciones = input.observaciones
    ? compactarEspacios(input.observaciones)
    : null;
  const envaseTipoNombre = compactarEspacios(input.envaseTipoNombre);
  const envaseTipoId =
    compactarEspacios(input.envaseTipoId) ||
    construirEnvaseTipoIdManual(envaseTipoNombre);
  const { envaseRef, envaseResult } = await resolveEnvaseResultForMovement(
    transaction,
    db,
    {
      envaseTipoId,
      envaseTipoNombre,
      envaseTipoCodigo: construirEnvaseTipoCodigoManual(envaseTipoNombre)
    }
  );
  const inventoryId = construirEnvaseInventoryIdCanonico({
    envaseTipoId: envaseTipoId || envaseResult.envase.id,
    envaseTipoCodigo: envaseResult.envase.codigo,
    envaseTipoNombre: envaseResult.envase.nombre,
    envaseEstado,
    kilos: input.kilos,
  });
  const hiddenLoteRef = db
    .collection(COLLECTIONS.envaseLotesOcultos)
    .doc(buildHiddenLoteId(inventoryId, cliente));

  if (envaseResult.envase.activo === false) {
    throw new Error("El tipo de envase seleccionado esta inactivo.");
  }

  transaction.set(movimientoRef, {
    tipoMovimiento: "ingreso",
    origen: "manual_ingreso",
    fechaMovimiento,
    ...fechaKeys,
    cliente,
    clienteNormalizado: normalizarTextoParaIndice(cliente),
    envaseTipoId,
    envaseTipoCodigo: envaseResult.envase.codigo,
    envaseTipoNombre: envaseResult.envase.nombre,
    envaseEstado,
    envaseEstadoNormalizado: normalizarTextoParaIndice(envaseEstado),
    kilos: input.kilos,
    cantidad: input.cantidad,
    inventoryId,
    transporte,
    causa: null,
    tipoProceso: null,
    observaciones,
    createdAt,
    updatedAt: now,
    createdBy,
    updatedBy: actorId
  });

  transaction.delete(hiddenLoteRef);

  if (envaseResult.envase.controlaStock !== false) {
    await syncEnvaseCounters(transaction, {
      envaseRef,
      envase: envaseResult.envase,
      existsInNuevaColeccion: envaseResult.existsInNuevaColeccion,
      now,
      movimientoId: movimientoRef.id,
      deltaStock: input.cantidad,
      deltaIngresos: input.cantidad,
      actorId
    });
  }
}

async function upsertBajaManualMovement(
  transaction: FirebaseFirestore.Transaction,
  params: {
    db: FirebaseFirestore.Firestore;
    movimientoRef: FirebaseFirestore.DocumentReference;
    input: EnvaseBajaFormInput;
    actorId: string;
    now: FirebaseFirestore.Timestamp;
    availabilityMap: Map<string, PlantStockEntry>;
    createdAt?: FirebaseFirestore.Timestamp;
    createdBy?: string;
    stockAdjustmentBeforeApply?: number;
  }
) {
  const {
    db,
    movimientoRef,
    input,
    actorId,
    now,
    availabilityMap,
    createdAt = now,
    createdBy = actorId,
    stockAdjustmentBeforeApply = 0
  } = params;
  const fechaKeys = construirClavesFecha(input.fechaMovimiento);
  const fechaMovimiento = Timestamp.fromDate(
    fechaIsoLocalToDate(input.fechaMovimiento)
  );
  const cliente = compactarEspacios(input.cliente);
  const causa = compactarEspacios(input.causa);
  const observaciones = input.observaciones
    ? compactarEspacios(input.observaciones)
    : null;
  const matchingInventory = availabilityMap.get(input.inventoryId);

  if (!matchingInventory) {
    throw new Error(
      "El ID de envase seleccionado ya no esta disponible en el stock general."
    );
  }

  if (matchingInventory.cantidad < input.cantidad) {
    throw new Error(
      `Solo hay ${matchingInventory.cantidad} envases disponibles para ${matchingInventory.envaseTipoNombre} | ${matchingInventory.envaseEstado} | ${matchingInventory.kilos} Kg.`
    );
  }

  const { envaseRef, envaseResult } = await resolveEnvaseResultForMovement(
    transaction,
    db,
    {
      envaseTipoId: matchingInventory.envaseTipoId,
      envaseTipoNombre: matchingInventory.envaseTipoNombre,
      envaseTipoCodigo: construirEnvaseTipoCodigoManual(
        matchingInventory.envaseTipoNombre
      )
    }
  );

  if (
    envaseResult.envase.controlaStock !== false &&
    envaseResult.envase.stockActual + stockAdjustmentBeforeApply < input.cantidad
  ) {
    throw new Error(
      `Stock insuficiente para ${envaseResult.envase.nombre}. Disponible: ${envaseResult.envase.stockActual + stockAdjustmentBeforeApply}, solicitado: ${input.cantidad}.`
    );
  }

  transaction.set(movimientoRef, {
    tipoMovimiento: input.tipoSalida === "retiro" ? "retiro" : "baja",
    origen: input.tipoSalida === "retiro" ? "manual_retiro" : "manual_baja",
    fechaMovimiento,
    ...fechaKeys,
    cliente,
    clienteNormalizado: normalizarTextoParaIndice(cliente),
    envaseTipoId: matchingInventory.envaseTipoId,
    envaseTipoCodigo: envaseResult.envase.codigo,
    envaseTipoNombre: envaseResult.envase.nombre,
    envaseEstado: matchingInventory.envaseEstado,
    envaseEstadoNormalizado: normalizarTextoParaIndice(matchingInventory.envaseEstado),
    kilos: matchingInventory.kilos,
    cantidad: input.cantidad,
    inventoryId: input.inventoryId,
    transporte: null,
    causa,
    tipoProceso: null,
    observaciones,
    createdAt,
    updatedAt: now,
    createdBy,
    updatedBy: actorId
  });

  if (envaseResult.envase.controlaStock !== false) {
    await syncEnvaseCounters(transaction, {
      envaseRef,
      envase: envaseResult.envase,
      existsInNuevaColeccion: envaseResult.existsInNuevaColeccion,
      now,
      movimientoId: movimientoRef.id,
      deltaStock: -input.cantidad,
      deltaAjustes: input.cantidad,
      actorId
    });
  }
}

async function getEnvasesMovimientos(limit = ENVASES_DASHBOARD_READ_LIMIT) {
  const db = getAdminDb();
  const [descargasSnap, procesosSnap, manualSnap] = await Promise.all([
    db.collection(COLLECTIONS.descargas).orderBy("createdAt", "desc").limit(limit).get(),
    db.collection(COLLECTIONS.procesos).orderBy("fechaProceso", "desc").limit(limit).get(),
    db
      .collection(COLLECTIONS.envaseMovimientos)
      .orderBy("fechaMovimiento", "desc")
      .limit(limit)
      .get()
  ]);

  return [
    ...descargasSnap.docs.flatMap((documento) => {
      return mapOperacionToEnvaseHistory(documento.id, documento.data());
    }),
    ...procesosSnap.docs.flatMap((documento) => {
      return mapProcesoToEnvaseHistory(documento.id, documento.data());
    }),
    ...manualSnap.docs.flatMap((documento) => {
      const mapped = parseManualEnvaseHistory(documento.id, documento.data());
      return mapped ? [mapped] : [];
    })
  ].sort((a, b) => {
    const aValue = a.fechaMovimiento?.getTime() ?? 0;
    const bValue = b.fechaMovimiento?.getTime() ?? 0;
    return bValue - aValue;
  });
}

export async function getEnvasesDashboardData(): Promise<EnvasesDashboardData> {
  const emptyData: EnvasesDashboardData = {
    firestoreDisponible: false,
    envases: [],
    clientesDisponibles: [],
    stockPlanta: [],
    historialDerivado: [],
  };

  try {
    const [envases, ledgerSnapshot] = await Promise.all([
      getEnvasesOperativos(),
      getEnvasesLedgerSnapshot(),
    ]);

    return {
      firestoreDisponible: true,
      envases,
      clientesDisponibles: ledgerSnapshot.clientesDisponibles,
      stockPlanta: ledgerSnapshot.stockPlanta,
      historialDerivado: ledgerSnapshot.movimientos,
    };
  } catch {
    return emptyData;
  }
}

export async function crearIngresoManualEnvase(
  rawInput: unknown,
  actorUid?: string
): Promise<ActionState<CrearMovimientoEnvaseData>> {
  const parsedInput = envaseIngresoManualFormSchema.safeParse(rawInput);

  if (!parsedInput.success) {
    return {
      ok: false,
      message: "El ingreso manual no paso la validacion del formulario.",
      fieldErrors: parsedInput.error.flatten().fieldErrors
    };
  }

  const input: EnvaseIngresoManualFormInput = parsedInput.data;
  const db = getAdminDb();
  const now = Timestamp.now();
  const actorId = actorUid?.trim() || DEFAULT_FIRESTORE_ACTOR;
  const movimientoRef = db.collection(COLLECTIONS.envaseMovimientos).doc();

  try {
    await db.runTransaction(async (transaction) => {
      await upsertIngresoManualMovement(transaction, {
        db,
        movimientoRef,
        input,
        actorId,
        now
      });
    });

    return {
      ok: true,
      message: "El ingreso manual de envases fue registrado.",
      data: {
        movimientoId: movimientoRef.id
      }
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "No fue posible registrar el ingreso manual."
    };
  }
}

export async function crearBajaManualEnvase(
  rawInput: unknown,
  actorUid?: string
): Promise<ActionState<CrearMovimientoEnvaseData>> {
  const parsedInput = envaseBajaFormSchema.safeParse(rawInput);

  if (!parsedInput.success) {
    return {
      ok: false,
      message: "La baja no paso la validacion del formulario.",
      fieldErrors: parsedInput.error.flatten().fieldErrors
    };
  }

  const input: EnvaseBajaFormInput = parsedInput.data;
  const db = getAdminDb();
  const now = Timestamp.now();
  const actorId = actorUid?.trim() || DEFAULT_FIRESTORE_ACTOR;
  const movimientoRef = db.collection(COLLECTIONS.envaseMovimientos).doc();
  const availabilityMap = await getPlantStockAvailabilityMap();

  try {
    await db.runTransaction(async (transaction) => {
      await upsertBajaManualMovement(transaction, {
        db,
        movimientoRef,
        input,
        actorId,
        now,
        availabilityMap
      });
    });

    return {
      ok: true,
      message: "La baja de envases fue registrada.",
      data: {
        movimientoId: movimientoRef.id
      }
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "No fue posible registrar la baja."
    };
  }
}

export async function actualizarIngresoManualEnvase(
  movimientoId: string,
  rawInput: unknown,
  actorUid?: string
): Promise<ActionState<CrearMovimientoEnvaseData>> {
  const parsedMovementId = envaseMovimientoManualIdSchema.safeParse({
    movimientoId
  });
  const parsedInput = envaseIngresoManualFormSchema.safeParse(rawInput);

  if (!parsedMovementId.success || !parsedInput.success) {
    return {
      ok: false,
      message: "El ingreso manual no paso la validacion del formulario.",
      fieldErrors: parsedInput.success
        ? undefined
        : parsedInput.error.flatten().fieldErrors
    };
  }

  const db = getAdminDb();
  const now = Timestamp.now();
  const actorId = actorUid?.trim() || DEFAULT_FIRESTORE_ACTOR;
  const movimientoRef = db
    .collection(COLLECTIONS.envaseMovimientos)
    .doc(parsedMovementId.data.movimientoId);

  try {
    await db.runTransaction(async (transaction) => {
      const movimientoSnap = await transaction.get(movimientoRef);

      if (!movimientoSnap.exists) {
        throw new Error("El movimiento manual seleccionado ya no existe.");
      }

      const currentMovement = getEditableManualMovement(
        movimientoSnap.id,
        movimientoSnap.data() ?? {}
      );

      if (currentMovement.origen !== "manual_ingreso") {
        throw new Error("Solo se puede editar un ingreso manual.");
      }

      await revertManualMovement(transaction, db, currentMovement, actorId, now);
      await upsertIngresoManualMovement(transaction, {
        db,
        movimientoRef,
        input: parsedInput.data,
        actorId,
        now,
        createdAt:
          movimientoSnap.get("createdAt") instanceof Timestamp
            ? movimientoSnap.get("createdAt")
            : now,
        createdBy:
          typeof movimientoSnap.get("createdBy") === "string"
            ? movimientoSnap.get("createdBy")
            : actorId
      });
    });

    return {
      ok: true,
      message: "El ingreso manual de envases fue actualizado.",
      data: {
        movimientoId: parsedMovementId.data.movimientoId
      }
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "No fue posible actualizar el ingreso manual."
    };
  }
}

export async function actualizarBajaManualEnvase(
  movimientoId: string,
  rawInput: unknown,
  actorUid?: string
): Promise<ActionState<CrearMovimientoEnvaseData>> {
  const parsedMovementId = envaseMovimientoManualIdSchema.safeParse({
    movimientoId
  });
  const parsedInput = envaseBajaFormSchema.safeParse(rawInput);

  if (!parsedMovementId.success || !parsedInput.success) {
    return {
      ok: false,
      message: "La baja no paso la validacion del formulario.",
      fieldErrors: parsedInput.success
        ? undefined
        : parsedInput.error.flatten().fieldErrors
    };
  }

  const db = getAdminDb();
  const now = Timestamp.now();
  const actorId = actorUid?.trim() || DEFAULT_FIRESTORE_ACTOR;
  const movimientoRef = db
    .collection(COLLECTIONS.envaseMovimientos)
    .doc(parsedMovementId.data.movimientoId);

  try {
    const availabilityMap = await getPlantStockAvailabilityMap();

    await db.runTransaction(async (transaction) => {
      const movimientoSnap = await transaction.get(movimientoRef);

      if (!movimientoSnap.exists) {
        throw new Error("El movimiento manual seleccionado ya no existe.");
      }

      const currentMovement = getEditableManualMovement(
        movimientoSnap.id,
        movimientoSnap.data() ?? {}
      );

      if (
        currentMovement.origen !== "manual_baja" &&
        currentMovement.origen !== "manual_retiro"
      ) {
        throw new Error("Solo se puede editar una baja o retiro manual.");
      }

      const scopedAvailability = new Map(availabilityMap);
      const currentEntry = scopedAvailability.get(currentMovement.inventoryId);

      if (currentEntry) {
        scopedAvailability.set(currentMovement.inventoryId, {
          ...currentEntry,
          cantidad: currentEntry.cantidad + currentMovement.cantidad,
        });
      } else {
        scopedAvailability.set(currentMovement.inventoryId, {
          inventoryId: currentMovement.inventoryId,
          visibleId: `${currentMovement.envaseTipoNombre} | ${currentMovement.envaseEstado} | ${currentMovement.kilos} kg`,
          envaseTipoId: currentMovement.envaseTipoId,
          envaseTipoCodigo: currentMovement.envaseTipoCodigo,
          envaseTipoNombre: currentMovement.envaseTipoNombre,
          envaseEstado: currentMovement.envaseEstado,
          kilos: currentMovement.kilos,
          cantidad: currentMovement.cantidad,
          transactionCount: 1,
        });
      }

      await revertManualMovement(transaction, db, currentMovement, actorId, now);
      await upsertBajaManualMovement(transaction, {
        db,
        movimientoRef,
        input: parsedInput.data,
        actorId,
        now,
        availabilityMap: scopedAvailability,
        createdAt:
          movimientoSnap.get("createdAt") instanceof Timestamp
            ? movimientoSnap.get("createdAt")
            : now,
        createdBy:
          typeof movimientoSnap.get("createdBy") === "string"
            ? movimientoSnap.get("createdBy")
            : actorId,
        stockAdjustmentBeforeApply: currentMovement.cantidad
      });
    });

    return {
      ok: true,
      message: "La baja manual de envases fue actualizada.",
      data: {
        movimientoId: parsedMovementId.data.movimientoId
      }
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "No fue posible actualizar la baja manual."
    };
  }
}

export async function eliminarMovimientoManualEnvase(
  movimientoId: string,
  actorUid?: string
): Promise<ActionState<CrearMovimientoEnvaseData>> {
  const parsedMovementId = envaseMovimientoManualIdSchema.safeParse({
    movimientoId
  });

  if (!parsedMovementId.success) {
    return {
      ok: false,
      message: "El movimiento manual seleccionado no es valido."
    };
  }

  const db = getAdminDb();
  const now = Timestamp.now();
  const actorId = actorUid?.trim() || DEFAULT_FIRESTORE_ACTOR;
  const movimientoRef = db
    .collection(COLLECTIONS.envaseMovimientos)
    .doc(parsedMovementId.data.movimientoId);

  try {
    await db.runTransaction(async (transaction) => {
      const movimientoSnap = await transaction.get(movimientoRef);

      if (!movimientoSnap.exists) {
        throw new Error("El movimiento manual seleccionado ya no existe.");
      }

      const currentMovement = getEditableManualMovement(
        movimientoSnap.id,
        movimientoSnap.data() ?? {}
      );

      await revertManualMovement(transaction, db, currentMovement, actorId, now);
      transaction.delete(movimientoRef);
    });

    return {
      ok: true,
      message: "El movimiento manual fue eliminado.",
      data: {
        movimientoId: parsedMovementId.data.movimientoId
      }
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "No fue posible eliminar el movimiento manual."
    };
  }
}

export async function ocultarLoteAgotadoEnvase(
  rawInput: unknown,
  actorUid?: string
): Promise<ActionState<OcultarLoteEnvaseData>> {
  const parsed = envaseLoteOcultoSchema.safeParse(rawInput);

  if (!parsed.success) {
    return {
      ok: false,
      message: "La referencia del lote no paso la validacion."
    };
  }

  const db = getAdminDb();
  const now = Timestamp.now();
  const actorId = actorUid?.trim() || DEFAULT_FIRESTORE_ACTOR;
  const cliente = compactarEspacios(parsed.data.cliente);
  const loteId = buildHiddenLoteId(parsed.data.inventoryId, cliente);

  try {
    await db
      .collection(COLLECTIONS.envaseLotesOcultos)
      .doc(loteId)
      .set({
        inventoryId: parsed.data.inventoryId,
        cliente,
        clienteNormalizado: normalizarTextoParaIndice(cliente),
        hiddenAt: now,
        hiddenBy: actorId
      });

    return {
      ok: true,
      message: "La referencia del lote agotado fue ocultada.",
      data: {
        loteId
      }
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "No fue posible ocultar la referencia del lote."
    };
  }
}
