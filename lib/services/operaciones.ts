import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { getOptionalPublicFirebaseConfig } from "@/lib/firebase/public-config";
import { getFirebaseSystemConfig } from "@/lib/firebase/system-config";
import {
  getPlantStockAvailabilityMap,
  getInventoryIdForDetail,
} from "@/lib/services/envases-ledger";
import { eliminarCartaDePorte } from "@/lib/services/storage";
import {
  buildStoredProcessLots,
  type StoredLotDispatchRecord,
} from "@/lib/shared/stored-process-lots";
import {
  compactarEspacios,
  construirClavesFecha,
  crearIdDescargaLegacy,
  fechaIsoLocalToDate,
  normalizarTextoOperativo,
  normalizarTextoParaIndice,
  sanearSegmentoArchivo,
  timestampLikeToDate
} from "@/lib/utils";
import {
  COLLECTIONS,
  cartaPorteArchivoSchema,
  descargaLegacySchema,
  envaseFormSchema,
  envaseSchema,
  envaseStockSchema,
  envaseTipoSchema,
  operacionEgresoFormSchema,
  operacionEgresoPersistenciaSchema,
  operacionIngresoPersistenciaSchema,
  operacionMercaderiaSchema,
  procesoRegistroSchema,
  type ActionState,
  type DashboardResumenDiario,
  type DescargaLegacy,
  type Envase,
  type EnvaseFormInput,
  type OperacionEnvaseDetalle,
  type OperacionLoteEnvasadoDetalle,
  type EnvaseStock,
  type EnvaseTipo,
  type ModoEnvasesOperacion,
  type OperacionEgresoPersistenciaInput,
  type OperacionIngresoPersistenciaInput,
  type OperacionMercaderia,
  type TipoModuloOperacion
} from "@/types/schema";

type OperacionPersistenciaInput =
  | OperacionIngresoPersistenciaInput
  | OperacionEgresoPersistenciaInput;

type OperacionEgresoUpdateInput = Omit<
  OperacionEgresoPersistenciaInput,
  "cartaPortePdf"
> & {
  cartaPortePdf?: OperacionEgresoPersistenciaInput["cartaPortePdf"];
};

export type EnvaseOption = Pick<
  Envase,
  | "codigo"
  | "nombre"
  | "descripcion"
  | "controlaStock"
  | "activo"
  | "orden"
  | "stockActual"
  | "ingresosAcumulados"
  | "egresosAcumulados"
  | "ajustesAcumulados"
> & {
  id: string;
  updatedAt: Date | null;
};

export type RegistroOperacion = Pick<
  OperacionMercaderia,
  | "tipoOperacion"
  | "numeroCartaPorte"
  | "cliente"
  | "destinatario"
  | "producto"
  | "kilos"
  | "cantidadEnvases"
  | "envaseTipoId"
  | "envaseTipoCodigo"
  | "envaseTipoNombre"
  | "envaseMode"
  | "loteEnvasadoDetalles"
  | "detalleEnvases"
  | "observaciones"
> & {
  id: string;
  proveedor: string;
  proceso: string;
  procedencia: string;
  envaseEstado: string;
  fechaOperacion: Date | null;
  createdAt: Date | null;
  cartaPorteUrl: string | null;
};

type RegistroOperacionEnvaseDetalle = OperacionEnvaseDetalle;

export type ModuloOperacionData = {
  tipo: TipoModuloOperacion;
  firestoreDisponible: boolean;
  storageConfigurado: boolean;
  envases: EnvaseOption[];
  registros: RegistroOperacion[];
  resumenHoy: DashboardResumenDiario;
};

export type CrearOperacionData = {
  operacionId: string;
  movimientoId: string | null;
};

export type OperacionMutationData = {
  operacionId: string;
};

export type CrearEnvaseData = {
  envaseId: string;
};

const OPERACION_CONFIG = {
  ingreso: {
    collection: COLLECTIONS.descargas,
    keyPrefix: "descarga",
    movimiento: "ingreso",
    origen: "operacion_ingreso",
    deltaSign: 1,
    totalOperacionesField: "totalOperacionesDescarga",
    totalKilosField: "totalKilosDescarga",
    totalEnvasesField: "totalEnvasesDescarga",
    schema: operacionIngresoPersistenciaSchema,
    successMessage: "La descarga fue registrada en Firestore.",
    failureMessage: "No fue posible registrar la descarga."
  },
  egreso: {
    collection: COLLECTIONS.cargas,
    keyPrefix: "carga",
    movimiento: "egreso",
    origen: "operacion_egreso",
    deltaSign: -1,
    totalOperacionesField: "totalOperacionesCarga",
    totalKilosField: "totalKilosCarga",
    totalEnvasesField: "totalEnvasesCarga",
    schema: operacionEgresoPersistenciaSchema,
    successMessage: "La carga fue registrada en Firestore.",
    failureMessage: "No fue posible registrar la carga."
  }
} as const;

const DEFAULT_FIRESTORE_ACTOR =
  process.env.FIRESTORE_DEFAULT_ACTOR?.trim() || "audit-alta-system";
const LEGACY_PACKAGING_ENVASE_ID = "legacy-packaging";
const LEGACY_PACKAGING_ENVASE_CODE = "PACK";
const LEGACY_PACKAGING_EMPTY_LABEL = "SIN DETALLE";
const LEGACY_TRUCK_PLATE_FALLBACK = "NO INFORMADA";
const SIN_ENVASE_TIPO_ID = "sin-envases";
const SIN_ENVASE_TIPO_CODE = "NA";
const SIN_ENVASE_TIPO_NOMBRE = "Sin envases";
const SIN_ENVASE_ESTADO = "Sin envases";
const DESCARGA_GRANEL_LABEL = "DESCARGA A GRANEL";
const DESCARGA_GRANEL_CODE = "GRANEL";
const DESCARGA_GRANEL_ESTADO = "A granel";

function getStorageConfigured() {
  const publicFirebaseConfig = getOptionalPublicFirebaseConfig();
  const systemConfig = getFirebaseSystemConfig();

  return Boolean(
    process.env.FIREBASE_STORAGE_BUCKET?.trim() ??
      systemConfig.storageBucket ??
      publicFirebaseConfig.storageBucket
  );
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function formatFechaRegistro(value: Date | null) {
  if (!value) {
    return "";
  }

  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
    const packagingType = compactarEspacios(movement.packagingType ?? "");
    const packagingCondition = compactarEspacios(movement.packagingCondition ?? "");

    if (packagingType) {
      packagingTypes.add(packagingType);
    }

    if (packagingCondition) {
      packagingConditions.add(packagingCondition);
    }

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
      packagingTypes.size > 0
        ? [...packagingTypes].join(" / ")
        : LEGACY_PACKAGING_EMPTY_LABEL,
    packagingConditionLabel:
      packagingConditions.size > 0
        ? [...packagingConditions].join(" / ")
        : LEGACY_PACKAGING_EMPTY_LABEL
  };
}

function buildDetalleEnvaseRecord(
  detail: Partial<RegistroOperacionEnvaseDetalle> & {
    envaseTipoId: string;
    envaseEstado: string;
  }
): RegistroOperacionEnvaseDetalle {
  const kilos = detail.kilos ?? 0;

  return {
    inventoryId:
      compactarEspacios(detail.inventoryId ?? "") ||
      getInventoryIdForDetail({
        envaseTipoId: detail.envaseTipoId,
        envaseEstado: detail.envaseEstado,
        kilos: Number(kilos ?? 0),
      }),
    envaseTipoId: detail.envaseTipoId,
    envaseTipoCodigo: detail.envaseTipoCodigo ?? LEGACY_PACKAGING_ENVASE_CODE,
    envaseTipoNombre: detail.envaseTipoNombre ?? LEGACY_PACKAGING_EMPTY_LABEL,
    envaseEstado: detail.envaseEstado,
    kilos,
    cantidad: detail.cantidad ?? 0
  };
}

function buildFallbackDetalleEnvases(
  record: Pick<
    OperacionMercaderia,
    | "envaseTipoId"
    | "envaseTipoCodigo"
    | "envaseTipoNombre"
    | "envaseEstado"
    | "kilos"
    | "cantidadEnvases"
    | "detalleEnvases"
  >
) {
  if (record.detalleEnvases && record.detalleEnvases.length > 0) {
    return record.detalleEnvases.map((detail) => buildDetalleEnvaseRecord(detail));
  }

  if (record.cantidadEnvases <= 0) {
    return [];
  }

  return [
    buildDetalleEnvaseRecord({
      envaseTipoId: record.envaseTipoId,
      envaseTipoCodigo: record.envaseTipoCodigo,
      envaseTipoNombre: record.envaseTipoNombre,
      envaseEstado: record.envaseEstado ?? "Conforme",
      kilos: record.kilos,
      cantidad: record.cantidadEnvases
    })
  ];
}

function buildLegacyDetalleEnvases(
  packagingMovements: DescargaLegacy["packagingMovements"],
  _totalKilos: number
) {
  const details = packagingMovements.flatMap((movement) => {
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

    return [
      buildDetalleEnvaseRecord({
        envaseTipoId: LEGACY_PACKAGING_ENVASE_ID,
        envaseTipoCodigo: LEGACY_PACKAGING_ENVASE_CODE,
        envaseTipoNombre: movement.packagingType ?? LEGACY_PACKAGING_EMPTY_LABEL,
        envaseEstado:
          movement.packagingCondition ?? LEGACY_PACKAGING_EMPTY_LABEL,
        kilos: getNumericValue(movement, [
          "packagingKg",
          "kilos",
          "kg",
          "weightKg"
        ]),
        cantidad
      })
    ];
  });

  return details;
}

function parseLegacyDescargaSnapshot(
  id: string,
  data: FirebaseFirestore.DocumentData
): RegistroOperacion | null {
  const parsed = descargaLegacySchema.safeParse(data);

  if (!parsed.success) {
    return null;
  }

  const packagingSummary = summarizeLegacyPackagingMovements(
    parsed.data.packagingMovements
  );
  const detalleEnvases = buildLegacyDetalleEnvases(
    parsed.data.packagingMovements,
    parsed.data.netKg
  );
  const numeroCartaPorte =
    data &&
    typeof data === "object" &&
    "numeroCartaPorte" in data &&
    typeof data.numeroCartaPorte === "string" &&
    data.numeroCartaPorte.trim().length > 0
      ? data.numeroCartaPorte
      : "";
  const cartaPorteUrl =
    data &&
    typeof data === "object" &&
    "cartaPortePdf" in data &&
    data.cartaPortePdf &&
    typeof data.cartaPortePdf === "object" &&
    "downloadUrl" in data.cartaPortePdf &&
    typeof data.cartaPortePdf.downloadUrl === "string"
      ? data.cartaPortePdf.downloadUrl
      : null;

  return {
    id,
    tipoOperacion: "ingreso",
    numeroCartaPorte,
    cliente: parsed.data.client,
    destinatario: "",
    producto: parsed.data.product,
    proveedor: parsed.data.supplier,
    proceso: parsed.data.processCode,
    procedencia: parsed.data.truckPlate || parsed.data.supplier || "No informado",
    kilos: parsed.data.netKg,
    cantidadEnvases: packagingSummary.quantity,
    envaseTipoId: LEGACY_PACKAGING_ENVASE_ID,
    envaseTipoCodigo: LEGACY_PACKAGING_ENVASE_CODE,
    envaseTipoNombre: packagingSummary.packagingTypeLabel,
    envaseMode: detalleEnvases.length > 0 ? "manual" : "granel",
    loteEnvasadoDetalles: [],
    detalleEnvases,
    envaseEstado: packagingSummary.packagingConditionLabel,
    observaciones: parsed.data.observations,
    fechaOperacion: timestampLikeToDate(parsed.data.entryDate),
    createdAt: timestampLikeToDate(parsed.data.createdAt ?? parsed.data.entryDate),
    cartaPorteUrl
  };
}

function parseOperacionSnapshot(
  id: string,
  data: FirebaseFirestore.DocumentData
): RegistroOperacion | null {
  const parsed = operacionMercaderiaSchema.safeParse(data);

  if (parsed.success) {
    const detalleEnvases = buildFallbackDetalleEnvases(parsed.data);
    const loteEnvasadoDetalles = getStoredLoteEnvasadoDetalles(data);
    const envaseMode =
      typeof data.envaseMode === "string"
        ? normalizeEnvaseMode(data.envaseMode)
        : loteEnvasadoDetalles.length > 0
          ? "envasados"
          : detalleEnvases.length > 0
            ? "manual"
            : "granel";

    return {
      id,
      tipoOperacion: parsed.data.tipoOperacion,
      numeroCartaPorte: parsed.data.numeroCartaPorte,
      cliente: parsed.data.cliente,
      destinatario: parsed.data.destinatario ?? "",
      producto: parsed.data.producto ?? parsed.data.proceso ?? "Sin producto",
      proveedor: parsed.data.proveedor ?? "No informado",
      proceso: parsed.data.proceso ?? parsed.data.producto ?? "Sin proceso",
      procedencia: parsed.data.procedencia ?? "No informado",
      kilos: parsed.data.kilos,
      cantidadEnvases: parsed.data.cantidadEnvases,
      envaseTipoId: parsed.data.envaseTipoId,
      envaseTipoCodigo: parsed.data.envaseTipoCodigo,
      envaseTipoNombre: parsed.data.envaseTipoNombre,
      envaseMode,
      loteEnvasadoDetalles,
      detalleEnvases,
      envaseEstado: parsed.data.envaseEstado ?? "Conforme",
      observaciones: parsed.data.observaciones,
      fechaOperacion: timestampLikeToDate(parsed.data.fechaOperacion),
      createdAt: timestampLikeToDate(parsed.data.createdAt),
      cartaPorteUrl: parsed.data.cartaPortePdf?.downloadUrl ?? null
    };
  }

  return parseLegacyDescargaSnapshot(id, data);
}

function parseEnvaseSnapshot(
  id: string,
  data: FirebaseFirestore.DocumentData
): EnvaseOption | null {
  const parsed = envaseSchema.safeParse(data);

  if (!parsed.success) {
    return null;
  }

  return {
    id,
    codigo: parsed.data.codigo,
    nombre: parsed.data.nombre,
    descripcion: parsed.data.descripcion,
    controlaStock: parsed.data.controlaStock,
    activo: parsed.data.activo,
    orden: parsed.data.orden,
    stockActual: parsed.data.stockActual,
    ingresosAcumulados: parsed.data.ingresosAcumulados,
    egresosAcumulados: parsed.data.egresosAcumulados,
    ajustesAcumulados: parsed.data.ajustesAcumulados,
    updatedAt: timestampLikeToDate(parsed.data.updatedAt)
  };
}

function mergeLegacyEnvase(
  id: string,
  tipo: EnvaseTipo,
  stock: EnvaseStock | null
): EnvaseOption {
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
    updatedAt: timestampLikeToDate(stock?.updatedAt ?? tipo.updatedAt)
  };
}

export async function getEnvasesOperativos(): Promise<EnvaseOption[]> {
  const db = getAdminDb();
  const envasesSnap = await db.collection(COLLECTIONS.envases).get();
  const envases = envasesSnap.docs
    .flatMap((documento) => {
      const parsed = parseEnvaseSnapshot(documento.id, documento.data());
      return parsed && parsed.activo ? [parsed] : [];
    })
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));

  if (envases.length > 0) {
    return envases;
  }

  const [tiposSnap, stockSnap] = await Promise.all([
    db.collection(COLLECTIONS.envaseTipos).get(),
    db.collection(COLLECTIONS.envaseStock).get()
  ]);
  const stockById = new Map<string, EnvaseStock>();

  for (const documento of stockSnap.docs) {
    const parsedStock = envaseStockSchema.safeParse(documento.data());

    if (parsedStock.success) {
      stockById.set(documento.id, parsedStock.data);
    }
  }

  return tiposSnap.docs
    .flatMap((documento) => {
      const parsedTipo = envaseTipoSchema.safeParse(documento.data());

      if (!parsedTipo.success || parsedTipo.data.activo === false) {
        return [];
      }

      return [
        mergeLegacyEnvase(
          documento.id,
          parsedTipo.data,
          stockById.get(documento.id) ?? null
        )
      ];
    })
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
}

export async function getModuloOperacionData(
  tipo: TipoModuloOperacion
): Promise<ModuloOperacionData> {
  const config = OPERACION_CONFIG[tipo];
  const operacionesLimit = tipo === "ingreso" ? 240 : 120;
  const fechaActual = getTodayKey();
  const emptyResumen: DashboardResumenDiario = {
    fechaKey: fechaActual,
    mesKey: fechaActual.slice(0, 7),
    anioKey: fechaActual.slice(0, 4),
    totalOperacionesCarga: 0,
    totalOperacionesDescarga: 0,
    totalKilosCarga: 0,
    totalKilosDescarga: 0,
    totalEnvasesCarga: 0,
    totalEnvasesDescarga: 0
  };

  const emptyData: ModuloOperacionData = {
    tipo,
    firestoreDisponible: false,
    storageConfigurado: getStorageConfigured(),
    envases: [],
    registros: [],
    resumenHoy: emptyResumen
  };

  try {
    const db = getAdminDb();
    const [envases, operacionesSnap] = await Promise.all([
      getEnvasesOperativos(),
      db
        .collection(config.collection)
        .orderBy("createdAt", "desc")
        .limit(operacionesLimit)
        .get()
    ]);
    const registros = operacionesSnap.docs.flatMap((documento) => {
      const parsed = parseOperacionSnapshot(documento.id, documento.data());
      return parsed ? [parsed] : [];
    });
    const resumenHoy = registros.reduce<DashboardResumenDiario>(
      (summary, registro) => {
        if (formatFechaRegistro(registro.fechaOperacion) !== fechaActual) {
          return summary;
        }

        if (tipo === "ingreso") {
          summary.totalOperacionesDescarga += 1;
          summary.totalKilosDescarga += registro.kilos;
          summary.totalEnvasesDescarga += registro.cantidadEnvases;
          return summary;
        }

        summary.totalOperacionesCarga += 1;
        summary.totalKilosCarga += registro.kilos;
        summary.totalEnvasesCarga += registro.cantidadEnvases;
        return summary;
      },
      { ...emptyResumen }
    );

    return {
      tipo,
      firestoreDisponible: true,
      storageConfigurado: emptyData.storageConfigurado,
      envases,
      registros,
      resumenHoy
    };
  } catch (error) {
    console.error(
      `[firestore] No fue posible leer ${config.collection} en getModuloOperacionData.`,
      error
    );
    return emptyData;
  }
}

function getEnvaseForTransaction(
  envaseId: string,
  envaseSnap: FirebaseFirestore.DocumentSnapshot,
  legacyTipoSnap: FirebaseFirestore.DocumentSnapshot,
  legacyStockSnap: FirebaseFirestore.DocumentSnapshot
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
      const stock = parsedStock?.success ? parsedStock.data : null;

      return {
        existsInNuevaColeccion: false,
        envase: {
          id: envaseId,
          codigo: parsedTipo.data.codigo,
          nombre: parsedTipo.data.nombre,
          descripcion: parsedTipo.data.descripcion,
          controlaStock: parsedTipo.data.controlaStock !== false,
          activo: parsedTipo.data.activo !== false,
          orden: parsedTipo.data.orden ?? 0,
          stockActual: stock?.stockActual ?? 0,
          ingresosAcumulados: stock?.ingresosAcumulados ?? 0,
          egresosAcumulados: stock?.egresosAcumulados ?? 0,
          ajustesAcumulados: stock?.ajustesAcumulados ?? 0,
          version: stock?.version ?? 0
        }
      };
    }
  }

  const fallbackNombre = compactarEspacios(envaseId);

  if (!fallbackNombre) {
    return null;
  }

  return {
    existsInNuevaColeccion: false,
    envase: {
      id: fallbackNombre,
      codigo: fallbackNombre.toUpperCase().slice(0, 32),
      nombre: fallbackNombre,
      descripcion: "",
      controlaStock: false,
      activo: true,
      orden: 0,
      stockActual: 0,
      ingresosAcumulados: 0,
      egresosAcumulados: 0,
      ajustesAcumulados: 0,
      version: 0
    }
  };
}

type EnvaseTransactionResult = NonNullable<
  ReturnType<typeof getEnvaseForTransaction>
>;

type OperacionEnvaseInput = {
  inventoryId: string;
  envaseTipoId: string;
  envaseTipoNombre: string;
  envaseEstado: string;
  kilos: number;
  cantidad: number;
};

type StoredLotInput = OperacionLoteEnvasadoDetalle;

type OperacionEnvaseResolved = RegistroOperacionEnvaseDetalle & {
  envase: EnvaseTransactionResult["envase"];
  existsInNuevaColeccion: boolean;
};

function normalizeEnvaseMode(
  value: string | ModoEnvasesOperacion | undefined | null,
): ModoEnvasesOperacion {
  return value === "manual" || value === "envasados" ? value : "granel";
}

function buildStoredLotInputs(input: OperacionPersistenciaInput) {
  return (input.loteEnvasadoDetalles ?? []).flatMap((detail) => {
    const storedItemId = compactarEspacios(detail.storedItemId ?? "");
    const procesoId = compactarEspacios(detail.procesoId ?? "");
    const salidaId = compactarEspacios(detail.salidaId ?? "");
    const cliente = compactarEspacios(detail.cliente ?? "");
    const proceso = compactarEspacios(detail.proceso ?? "");
    const producto = compactarEspacios(detail.producto ?? "");
    const procedencia = compactarEspacios(detail.procedencia ?? "");
    const envaseTipoId = compactarEspacios(detail.envaseTipoId ?? "");
    const envaseTipoNombre = compactarEspacios(detail.envaseTipoNombre ?? "");
    const envaseEstado = compactarEspacios(detail.envaseEstado ?? "");
    const envaseVisibleId = compactarEspacios(detail.envaseVisibleId ?? "");
    const pesoEnvaseKg = Number(detail.pesoEnvaseKg ?? 0);
    const cantidad = Number(detail.cantidad ?? 0);
    const kilos = Number(detail.kilos ?? 0);

    if (
      !storedItemId ||
      !procesoId ||
      !salidaId ||
      !cliente ||
      !proceso ||
      !producto ||
      !procedencia ||
      !envaseTipoId ||
      !envaseTipoNombre ||
      !envaseEstado ||
      !envaseVisibleId ||
      !Number.isFinite(pesoEnvaseKg) ||
      pesoEnvaseKg < 0 ||
      !Number.isFinite(cantidad) ||
      cantidad <= 0 ||
      !Number.isFinite(kilos) ||
      kilos <= 0
    ) {
      return [];
    }

    return [
      {
        storedItemId,
        procesoId,
        salidaId,
        cliente,
        proceso,
        producto,
        procedencia,
        envaseTipoId,
        envaseTipoNombre,
        envaseEstado,
        envaseVisibleId,
        pesoEnvaseKg,
        cantidad,
        kilos,
      } satisfies StoredLotInput,
    ];
  });
}

function buildOperacionEnvaseInputs(input: OperacionPersistenciaInput) {
  const detalleEnvases = (input.detalleEnvases ?? []).flatMap((detail) => {
    const inventoryId = compactarEspacios(detail.inventoryId ?? "");
    const envaseTipoId = compactarEspacios(detail.envaseTipoId ?? "");
    const envaseTipoNombre = compactarEspacios(detail.envaseTipoNombre ?? "");
    const envaseEstado = compactarEspacios(detail.envaseEstado ?? "");
    const kilos = Number(detail.kilos ?? 0);
    const cantidad = Number(detail.cantidad ?? 0);

    if (
      !envaseTipoId ||
      !envaseEstado ||
      !Number.isFinite(kilos) ||
      kilos < 0 ||
      !Number.isFinite(cantidad) ||
      cantidad <= 0
    ) {
      return [];
    }

    return [
      {
        inventoryId:
          inventoryId ||
          getInventoryIdForDetail({
            envaseTipoId,
            envaseEstado,
            kilos,
          }),
        envaseTipoId,
        envaseTipoNombre,
        envaseEstado,
        kilos,
        cantidad
      }
    ];
  });

  if (detalleEnvases.length > 0) {
    return detalleEnvases;
  }

  if (input.cantidadEnvases <= 0) {
    return [];
  }

  return [
    {
      inventoryId: getInventoryIdForDetail({
        envaseTipoId: compactarEspacios(input.envaseTipoId),
        envaseEstado: compactarEspacios(input.envaseEstado),
        kilos: input.kilos,
      }),
      envaseTipoId: compactarEspacios(input.envaseTipoId),
      envaseTipoNombre: "",
      envaseEstado: compactarEspacios(input.envaseEstado),
      kilos: input.kilos,
      cantidad: input.cantidadEnvases
    }
  ];
}

function buildLegacyPackagingPayload(
  operacionId: string,
  detalleEnvases: OperacionEnvaseResolved[]
) {
  return detalleEnvases.map((detail, index) => ({
    id: `PKG-${operacionId}-${index + 1}`,
    movementType: "alta",
    packagingType: detail.envaseTipoNombre,
    packagingCondition: detail.envaseEstado,
    packagingKg: detail.kilos,
    quantity: detail.cantidad
  }));
}

function buildPersistedDetalleEnvases(
  detalleEnvases: OperacionEnvaseResolved[],
  rawDetalleEnvases: OperacionPersistenciaInput["detalleEnvases"] = []
): OperacionEnvaseDetalle[] {
  const persistedDetails = detalleEnvases.map((detail) => ({
    inventoryId:
      compactarEspacios(detail.inventoryId ?? "") ||
      getInventoryIdForDetail({
        envaseTipoId: detail.envaseTipoId,
        envaseEstado: detail.envaseEstado,
        kilos: detail.kilos,
      }),
    envaseTipoId: detail.envaseTipoId,
    envaseTipoCodigo: detail.envaseTipoCodigo,
    envaseTipoNombre: detail.envaseTipoNombre,
    envaseEstado: detail.envaseEstado,
    kilos: detail.kilos,
    cantidad: detail.cantidad
  }));

  if (persistedDetails.length > 0) {
    return persistedDetails;
  }

  return rawDetalleEnvases.flatMap((detail) => {
    const envaseTipoId = compactarEspacios(detail.envaseTipoId ?? "");
    const envaseTipoNombre = compactarEspacios(detail.envaseTipoNombre ?? "");

    if (!envaseTipoId) {
      return [];
    }

    const envaseEstado =
      compactarEspacios(detail.envaseEstado ?? "") || DESCARGA_GRANEL_ESTADO;
    const kilos = Number(detail.kilos ?? 0);
    const cantidad = Number(detail.cantidad ?? 0);

    return [
      {
        inventoryId:
          compactarEspacios(detail.inventoryId ?? "") ||
          getInventoryIdForDetail({
            envaseTipoId,
            envaseEstado,
            kilos: Number.isFinite(kilos) && kilos >= 0 ? kilos : 0,
          }),
        envaseTipoId,
        envaseTipoCodigo: DESCARGA_GRANEL_CODE,
        envaseTipoNombre: envaseTipoNombre || envaseTipoId || DESCARGA_GRANEL_LABEL,
        envaseEstado,
        kilos: Number.isFinite(kilos) && kilos >= 0 ? kilos : 0,
        cantidad: Number.isFinite(cantidad) && cantidad >= 0 ? cantidad : 0
      }
    ];
  });
}

function getStoredDetalleEnvases(
  data: FirebaseFirestore.DocumentData | undefined
): OperacionEnvaseDetalle[] {
  if (!data || !Array.isArray(data.detalleEnvases)) {
    return [];
  }

  return data.detalleEnvases.flatMap((detail) => {
    if (!detail || typeof detail !== "object") {
      return [];
    }

    const envaseTipoId =
      typeof detail.envaseTipoId === "string" ? compactarEspacios(detail.envaseTipoId) : "";
    const envaseEstado =
      typeof detail.envaseEstado === "string" ? compactarEspacios(detail.envaseEstado) : "";
    const envaseTipoCodigo =
      typeof detail.envaseTipoCodigo === "string"
        ? compactarEspacios(detail.envaseTipoCodigo)
        : "";
    const envaseTipoNombre =
      typeof detail.envaseTipoNombre === "string"
        ? compactarEspacios(detail.envaseTipoNombre)
        : "";
    const inventoryId =
      typeof detail.inventoryId === "string"
        ? compactarEspacios(detail.inventoryId)
        : "";
    const kilos =
      typeof detail.kilos === "number" && Number.isFinite(detail.kilos) ? detail.kilos : 0;
    const cantidad =
      typeof detail.cantidad === "number" && Number.isFinite(detail.cantidad)
        ? detail.cantidad
        : 0;

    if (!envaseTipoId || !envaseEstado || cantidad <= 0) {
      return [];
    }

    return [
      {
        inventoryId:
          inventoryId ||
          getInventoryIdForDetail({
            envaseTipoId,
            envaseEstado,
            kilos,
          }),
        envaseTipoId,
        envaseTipoCodigo: envaseTipoCodigo || LEGACY_PACKAGING_ENVASE_CODE,
        envaseTipoNombre: envaseTipoNombre || LEGACY_PACKAGING_EMPTY_LABEL,
        envaseEstado,
        kilos,
        cantidad
      }
    ];
  });
}

function getStoredLoteEnvasadoDetalles(
  data: FirebaseFirestore.DocumentData | undefined,
): OperacionLoteEnvasadoDetalle[] {
  if (!data || !Array.isArray(data.loteEnvasadoDetalles)) {
    return [];
  }

  return data.loteEnvasadoDetalles.flatMap((detail) => {
    if (!detail || typeof detail !== "object") {
      return [];
    }

    const storedItemId =
      typeof detail.storedItemId === "string"
        ? compactarEspacios(detail.storedItemId)
        : "";
    const procesoId =
      typeof detail.procesoId === "string"
        ? compactarEspacios(detail.procesoId)
        : "";
    const salidaId =
      typeof detail.salidaId === "string"
        ? compactarEspacios(detail.salidaId)
        : "";
    const cliente =
      typeof detail.cliente === "string"
        ? compactarEspacios(detail.cliente)
        : "";
    const proceso =
      typeof detail.proceso === "string"
        ? compactarEspacios(detail.proceso)
        : "";
    const producto =
      typeof detail.producto === "string"
        ? compactarEspacios(detail.producto)
        : "";
    const procedencia =
      typeof detail.procedencia === "string"
        ? compactarEspacios(detail.procedencia)
        : "";
    const envaseTipoId =
      typeof detail.envaseTipoId === "string"
        ? compactarEspacios(detail.envaseTipoId)
        : "";
    const envaseTipoNombre =
      typeof detail.envaseTipoNombre === "string"
        ? compactarEspacios(detail.envaseTipoNombre)
        : "";
    const envaseEstado =
      typeof detail.envaseEstado === "string"
        ? compactarEspacios(detail.envaseEstado)
        : "";
    const envaseVisibleId =
      typeof detail.envaseVisibleId === "string"
        ? compactarEspacios(detail.envaseVisibleId)
        : "";
    const pesoEnvaseKg =
      typeof detail.pesoEnvaseKg === "number" &&
      Number.isFinite(detail.pesoEnvaseKg)
        ? detail.pesoEnvaseKg
        : 0;
    const cantidad =
      typeof detail.cantidad === "number" && Number.isFinite(detail.cantidad)
        ? detail.cantidad
        : 0;
    const kilos =
      typeof detail.kilos === "number" && Number.isFinite(detail.kilos)
        ? detail.kilos
        : 0;

    if (
      !storedItemId ||
      !procesoId ||
      !salidaId ||
      !cliente ||
      !proceso ||
      !producto ||
      !procedencia ||
      !envaseTipoId ||
      !envaseTipoNombre ||
      !envaseEstado ||
      !envaseVisibleId ||
      cantidad <= 0 ||
      kilos <= 0
    ) {
      return [];
    }

    return [
      {
        storedItemId,
        procesoId,
        salidaId,
        cliente,
        proceso,
        producto,
        procedencia,
        envaseTipoId,
        envaseTipoNombre,
        envaseEstado,
        envaseVisibleId,
        pesoEnvaseKg,
        cantidad,
        kilos,
      },
    ];
  });
}

function getCartaPorteStoragePath(data: FirebaseFirestore.DocumentData | undefined) {
  const cartaPortePdf = data?.cartaPortePdf;

  if (
    cartaPortePdf &&
    typeof cartaPortePdf === "object" &&
    "storagePath" in cartaPortePdf &&
    typeof cartaPortePdf.storagePath === "string" &&
    cartaPortePdf.storagePath.trim().length > 0
  ) {
    return cartaPortePdf.storagePath;
  }

  return null;
}

async function getStoredLotsAvailabilityForEgresos(
  transaction: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  excludedOperacionId?: string,
) {
  const [procesosSnap, cargasSnap] = await Promise.all([
    transaction.get(db.collection(COLLECTIONS.procesos).limit(400)),
    transaction.get(db.collection(COLLECTIONS.cargas).limit(400)),
  ]);

  const processRecords = procesosSnap.docs.flatMap((documento) => {
    const parsed = procesoRegistroSchema.safeParse(documento.data());

    if (!parsed.success) {
      return [];
    }

    return [
      {
        id: documento.id,
        fechaProceso: timestampLikeToDate(parsed.data.fechaProceso),
        cliente: parsed.data.cliente,
        proceso: parsed.data.proceso || parsed.data.numeroProceso || "",
        producto: parsed.data.producto || "",
        procedencia: parsed.data.procedencia || parsed.data.proveedor || "",
        proveedor: parsed.data.proveedor || parsed.data.procedencia || "",
        tipoOrden: parsed.data.tipoOrden || "procesado",
        salidas:
          parsed.data.salidas && parsed.data.salidas.length > 0
            ? parsed.data.salidas
            : [],
      },
    ];
  });
  const dispatchRecords = cargasSnap.docs.flatMap((documento) => {
    if (excludedOperacionId && documento.id === excludedOperacionId) {
      return [];
    }

    const parsed = operacionMercaderiaSchema.safeParse(documento.data());

    if (!parsed.success || parsed.data.tipoOperacion !== "egreso") {
      return [];
    }

    return [
      {
        id: documento.id,
        envaseMode: normalizeEnvaseMode(parsed.data.envaseMode),
        loteEnvasadoDetalles: getStoredLoteEnvasadoDetalles(documento.data()),
      } satisfies StoredLotDispatchRecord,
    ];
  });

  return buildStoredProcessLots(processRecords, dispatchRecords);
}

async function getOperacionMovementDocs(
  transaction: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  operacionId: string,
  envaseIds: string[],
) {
  const uniqueEnvaseIds = [...new Set(envaseIds.map(compactarEspacios).filter(Boolean))];
  const movementDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];

  for (const envaseId of uniqueEnvaseIds) {
    const envaseMovimientosSnap = await transaction.get(
      db
        .collection(COLLECTIONS.envases)
        .doc(envaseId)
        .collection("movimientos")
        .where("operacionId", "==", operacionId),
    );

    movementDocs.push(...envaseMovimientosSnap.docs);
  }

  return movementDocs;
}

function buildLegacyDescargaDocumentPayload({
  operacionId,
  input,
  actorId,
  now,
  nowMs,
  detalleEnvases,
  existingData,
  cartaPortePdf
}: {
  operacionId: string;
  input: OperacionIngresoPersistenciaInput;
  actorId: string;
  now: Timestamp;
  nowMs: number;
  detalleEnvases: OperacionEnvaseResolved[];
  existingData?: FirebaseFirestore.DocumentData;
  cartaPortePdf?: OperacionIngresoPersistenciaInput["cartaPortePdf"];
}) {
  const cliente = compactarEspacios(input.cliente);
  const proveedor = compactarEspacios(input.proveedor);
  const proceso = compactarEspacios(input.proceso);
  const producto = compactarEspacios(input.producto ?? input.proceso);
  const observaciones = input.observaciones
    ? compactarEspacios(input.observaciones)
    : null;
  const numeroCartaPorteInformado = compactarEspacios(input.numeroCartaPorte);
  const numeroCartaPorte =
    numeroCartaPorteInformado && !numeroCartaPorteInformado.startsWith("MANUAL-")
      ? numeroCartaPorteInformado
      : "";
  const truckPlate =
    existingData && typeof existingData.truckPlate === "string"
      ? compactarEspacios(existingData.truckPlate)
      : "";
  const createdAt =
    existingData?.createdAt instanceof Timestamp ? existingData.createdAt : now;
  const createdAtMs =
    typeof existingData?.createdAtMs === "number" && Number.isFinite(existingData.createdAtMs)
      ? existingData.createdAtMs
      : nowMs;
  const createdBy =
    existingData && typeof existingData.createdBy === "string"
      ? compactarEspacios(existingData.createdBy)
      : actorId;
  const withAnalysis =
    existingData && typeof existingData.withAnalysis === "boolean"
      ? existingData.withAnalysis
      : false;
  const analysisCode =
    existingData && typeof existingData.analysisCode === "string"
      ? compactarEspacios(existingData.analysisCode)
      : "";
  const persistedDetalleEnvases = buildPersistedDetalleEnvases(
    detalleEnvases,
    input.detalleEnvases
  );
  const primaryDetail = persistedDetalleEnvases[0] ?? {
    envaseTipoId: SIN_ENVASE_TIPO_ID,
    envaseTipoCodigo: SIN_ENVASE_TIPO_CODE,
    envaseTipoNombre: SIN_ENVASE_TIPO_NOMBRE,
    envaseEstado: SIN_ENVASE_ESTADO,
    kilos: 0,
    cantidad: 0
  };

  return {
    id: operacionId,
    entryDate: input.fechaOperacion,
    truckPlate,
    client: normalizarTextoOperativo(cliente),
    supplier: normalizarTextoOperativo(proveedor),
    product: normalizarTextoOperativo(producto),
    processCode: normalizarTextoOperativo(proceso),
    grossKg: input.kilos,
    tareKg: 0,
    netKg: input.kilos,
    withAnalysis,
    analysisCode,
    observations: observaciones,
    packagingMovements: buildLegacyPackagingPayload(operacionId, detalleEnvases),
    cantidadEnvases: persistedDetalleEnvases.reduce(
      (total, detail) => total + Number(detail.cantidad ?? 0),
      0
    ),
    envaseTipoId: primaryDetail.envaseTipoId,
    envaseTipoCodigo: primaryDetail.envaseTipoCodigo,
    envaseTipoNombre: primaryDetail.envaseTipoNombre,
    envaseEstado: primaryDetail.envaseEstado,
    detalleEnvases: persistedDetalleEnvases,
    createdAtMs,
    updatedAtMs: nowMs,
    createdAt,
    updatedAt: now,
    createdBy,
    updatedBy: actorId,
    ...(numeroCartaPorte ? { numeroCartaPorte } : {}),
    ...(cartaPortePdf ? { cartaPortePdf } : {}),
    ...(!cartaPortePdf && existingData?.cartaPortePdf ? { cartaPortePdf: existingData.cartaPortePdf } : {})
  };
}

function applyLegacyIngresoStockDelta(
  transaction: FirebaseFirestore.Transaction,
  envaseRef: FirebaseFirestore.DocumentReference,
  update: {
    stockDelta: number;
    ingresosDelta: number;
    egresosDelta: number;
  },
  actorId: string,
  now: Timestamp
) {
  transaction.set(
    envaseRef,
    {
      stockActual: FieldValue.increment(update.stockDelta),
      ingresosAcumulados: FieldValue.increment(update.ingresosDelta),
      egresosAcumulados: FieldValue.increment(update.egresosDelta),
      updatedAt: now,
      updatedBy: actorId,
      version: FieldValue.increment(1)
    },
    { merge: true }
  );
}

async function crearOperacionTransaccional(
  input: OperacionPersistenciaInput,
  actorUid?: string
): Promise<ActionState<CrearOperacionData>> {
  const db = getAdminDb();
  const config = OPERACION_CONFIG[input.tipoOperacion];
  const actorId = actorUid?.trim() || DEFAULT_FIRESTORE_ACTOR;
  const cliente = compactarEspacios(input.cliente);
  const proveedor = compactarEspacios(input.proveedor || input.procedencia);
  const proceso = compactarEspacios(input.proceso);
  const procedencia = compactarEspacios(input.procedencia || input.proveedor);
  const destinatario = compactarEspacios(input.destinatario ?? "");
  const producto = compactarEspacios(input.producto ?? input.proceso);
  const envaseMode = normalizeEnvaseMode(input.envaseMode);
  const allowStockInsuficiente =
    input.tipoOperacion === "egreso" &&
    "confirmarStockInsuficiente" in input &&
    input.confirmarStockInsuficiente === true;
  const observaciones = input.observaciones
    ? compactarEspacios(input.observaciones)
    : null;
  const fechaKeys = construirClavesFecha(input.fechaOperacion);
  const timestampOperacion = Timestamp.fromDate(
    new Date(`${input.fechaOperacion}T00:00:00.000Z`)
  );
  const now = Timestamp.now();
  const nowMs = now.toMillis();
  const operacionId =
    input.tipoOperacion === "ingreso"
      ? crearIdDescargaLegacy(nowMs)
      : db.collection(config.collection).doc().id;
  const numeroCartaPorteInformado = compactarEspacios(input.numeroCartaPorte);
  const numeroCartaPorte =
    numeroCartaPorteInformado ||
    (input.tipoOperacion === "ingreso" ? `MANUAL-${operacionId}` : "");
  const numeroCartaPorteNormalizado = normalizarTextoParaIndice(numeroCartaPorte);
  const clienteNormalizado = normalizarTextoParaIndice(cliente);
  const proveedorNormalizado = normalizarTextoParaIndice(proveedor);
  const procesoNormalizado = normalizarTextoParaIndice(proceso);
  const procedenciaNormalizada = normalizarTextoParaIndice(procedencia);
  const destinatarioNormalizado = normalizarTextoParaIndice(destinatario);
  const productoNormalizado = normalizarTextoParaIndice(producto);
  const detalleEnvasesInput =
    envaseMode === "manual" ? buildOperacionEnvaseInputs(input) : [];
  const loteEnvasadoDetallesInput =
    envaseMode === "manual" ? [] : buildStoredLotInputs(input);
  const totalCantidadEnvases =
    envaseMode === "manual"
      ? detalleEnvasesInput.reduce((total, detail) => total + detail.cantidad, 0)
      : loteEnvasadoDetallesInput.reduce(
          (total, detail) => total + detail.cantidad,
          0,
        );
  const operacionRef = db.collection(config.collection).doc(operacionId);
  const uniqueKeyRef = db
    .collection(COLLECTIONS.operacionesKeys)
    .doc(`${config.keyPrefix}__${numeroCartaPorteNormalizado}`);
  const resumenDiarioRef = db
    .collection(COLLECTIONS.dashboardResumenDiario)
    .doc(fechaKeys.fechaKey);

  try {
    let movimientoId: string | null = null;

    await db.runTransaction(async (transaction) => {
      const uniqueKeySnap = await transaction.get(uniqueKeyRef);

      if (uniqueKeySnap.exists) {
        throw new Error(
          `Ya existe un registro para la referencia ${numeroCartaPorte}.`
        );
      }

      const uniqueEnvaseIds = [
        ...new Set(detalleEnvasesInput.map((detail) => detail.envaseTipoId))
      ];
      const envasesResolved = new Map<string, EnvaseTransactionResult>();

      await Promise.all(
        uniqueEnvaseIds.map(async (envaseId) => {
          const envaseRef = db.collection(COLLECTIONS.envases).doc(envaseId);
          const legacyTipoRef = db.collection(COLLECTIONS.envaseTipos).doc(envaseId);
          const legacyStockRef = db.collection(COLLECTIONS.envaseStock).doc(envaseId);
          const [envaseSnap, legacyTipoSnap, legacyStockSnap] = await Promise.all([
            transaction.get(envaseRef),
            transaction.get(legacyTipoRef),
            transaction.get(legacyStockRef)
          ]);
          const envaseResult = getEnvaseForTransaction(
            envaseId,
            envaseSnap,
            legacyTipoSnap,
            legacyStockSnap
          );

          if (!envaseResult) {
            throw new Error("Uno de los envases seleccionados no existe.");
          }

          if (envaseResult.envase.activo === false) {
            throw new Error(
              `El envase ${envaseResult.envase.nombre} esta inactivo y no puede utilizarse.`
            );
          }

          envasesResolved.set(envaseId, envaseResult);
        })
      );

      const requestedByInventory = new Map<string, number>();

      for (const detail of detalleEnvasesInput) {
        const inventoryId =
          compactarEspacios(detail.inventoryId) ||
          getInventoryIdForDetail({
            envaseTipoId: detail.envaseTipoId,
            envaseEstado: detail.envaseEstado,
            kilos: detail.kilos,
          });
        requestedByInventory.set(
          inventoryId,
          (requestedByInventory.get(inventoryId) ?? 0) + detail.cantidad
        );
      }

      if (input.tipoOperacion === "egreso" && envaseMode === "manual") {
        const availabilityMap = await getPlantStockAvailabilityMap();

        for (const [inventoryId, cantidadSolicitada] of requestedByInventory) {
          const availableEntry = availabilityMap.get(inventoryId);

          if (
            !allowStockInsuficiente &&
            (!availableEntry || availableEntry.cantidad < cantidadSolicitada)
          ) {
            throw new Error(
              `Stock insuficiente para ${availableEntry?.visibleId ?? inventoryId}. Disponible: ${availableEntry?.cantidad ?? 0}, solicitado: ${cantidadSolicitada}.`
            );
          }
        }
      }

      if (input.tipoOperacion === "egreso" && envaseMode !== "manual") {
        const storedLots = await getStoredLotsAvailabilityForEgresos(
          transaction,
          db,
        );
        const storedLotsById = new Map(
          storedLots.map((lot) => [lot.storedItemId, lot]),
        );

        for (const detail of loteEnvasadoDetallesInput) {
          const lot = storedLotsById.get(detail.storedItemId);

          if (!lot) {
            throw new Error("El lote envasado seleccionado ya no esta disponible.");
          }

          if (!allowStockInsuficiente && detail.cantidad > lot.cantidadDisponible) {
            throw new Error(
              `Stock insuficiente para ${lot.envaseVisibleId}. Disponible: ${lot.cantidadDisponible}, solicitado: ${detail.cantidad}.`,
            );
          }

          if (detail.kilos > lot.kilosDisponibles) {
            throw new Error(
              `Kilos insuficientes para ${lot.envaseVisibleId}. Disponible: ${lot.kilosDisponibles}, solicitado: ${detail.kilos}.`,
            );
          }
        }
      }

      const detalleEnvases = detalleEnvasesInput.map((detail) => {
        const envaseResult = envasesResolved.get(detail.envaseTipoId);

        if (!envaseResult) {
          throw new Error("No fue posible resolver el detalle de envases.");
        }

        return {
          inventoryId:
            compactarEspacios(detail.inventoryId ?? "") ||
            getInventoryIdForDetail({
              envaseTipoId: detail.envaseTipoId,
              envaseEstado: detail.envaseEstado,
              kilos: detail.kilos,
            }),
          envaseTipoId: detail.envaseTipoId,
          envaseTipoCodigo: envaseResult.envase.codigo,
          envaseTipoNombre:
            compactarEspacios(detail.envaseTipoNombre) || envaseResult.envase.nombre,
          envaseEstado: detail.envaseEstado,
          kilos: detail.kilos,
          cantidad: detail.cantidad,
          envase: envaseResult.envase,
          existsInNuevaColeccion: envaseResult.existsInNuevaColeccion
        } satisfies OperacionEnvaseResolved;
      });

      const primaryLote = loteEnvasadoDetallesInput[0] ?? null;
      const primaryDetail = detalleEnvases[0] ?? (primaryLote
        ? {
            envaseTipoId: primaryLote.envaseTipoId,
            envaseTipoCodigo: primaryLote.envaseTipoId.toUpperCase().slice(0, 32),
            envaseTipoNombre: primaryLote.envaseTipoNombre,
            envaseEstado: primaryLote.envaseEstado,
            kilos: primaryLote.pesoEnvaseKg,
            cantidad: primaryLote.cantidad,
            envase: {
              id: primaryLote.envaseTipoId,
              codigo: primaryLote.envaseTipoId.toUpperCase().slice(0, 32),
              nombre: primaryLote.envaseTipoNombre,
              descripcion: "",
              controlaStock: false,
              activo: true,
              orden: 0,
              stockActual: 0,
              ingresosAcumulados: 0,
              egresosAcumulados: 0,
              ajustesAcumulados: 0,
              version: 0,
            },
            existsInNuevaColeccion: false,
          }
        : {
        envaseTipoId: SIN_ENVASE_TIPO_ID,
        envaseTipoCodigo: SIN_ENVASE_TIPO_CODE,
        envaseTipoNombre: SIN_ENVASE_TIPO_NOMBRE,
        envaseEstado: SIN_ENVASE_ESTADO,
        kilos: 0,
        cantidad: 0,
        envase: {
          id: SIN_ENVASE_TIPO_ID,
          codigo: SIN_ENVASE_TIPO_CODE,
          nombre: SIN_ENVASE_TIPO_NOMBRE,
          descripcion: "",
          controlaStock: false,
          activo: true,
          orden: 0,
          stockActual: 0,
          ingresosAcumulados: 0,
          egresosAcumulados: 0,
          ajustesAcumulados: 0,
          version: 0
        },
        existsInNuevaColeccion: false
      });

      const legacyDescargaPayload =
        input.tipoOperacion === "ingreso"
          ? {
              id: operacionId,
              entryDate: timestampOperacion,
              truckPlate: procedencia || LEGACY_TRUCK_PLATE_FALLBACK,
              client: normalizarTextoOperativo(cliente),
              supplier: normalizarTextoOperativo(proveedor),
              product: normalizarTextoOperativo(producto),
              processCode: normalizarTextoOperativo(proceso),
              grossKg: input.kilos,
              tareKg: 0,
              netKg: input.kilos,
              withAnalysis: false,
              observations: observaciones,
              packagingMovements: buildLegacyPackagingPayload(
                operacionId,
                detalleEnvases
              ),
              createdAtMs: nowMs,
              updatedAtMs: nowMs,
              createdAt: now,
              updatedAt: now,
              createdBy: actorId,
              updatedBy: actorId
            }
          : null;
      const persistedDetalleEnvases =
        envaseMode === "manual"
          ? detalleEnvases.map(
              ({
                envaseTipoId,
                envaseTipoCodigo,
                envaseTipoNombre,
                envaseEstado,
                kilos,
                cantidad
              }) => ({
                envaseTipoId,
                envaseTipoCodigo,
                envaseTipoNombre,
                envaseEstado,
                kilos,
                cantidad
              })
            )
          : [];
      const stockUpdates = new Map<
        string,
        {
          envaseRef: FirebaseFirestore.DocumentReference;
          envase: EnvaseTransactionResult["envase"];
          existsInNuevaColeccion: boolean;
          stockDelta: number;
          ingresosDelta: number;
          egresosDelta: number;
          lastMovimientoId: string;
        }
      >();

      for (const detail of detalleEnvases) {
        if (detail.envase.controlaStock === false) {
          continue;
        }

        const envaseRef = db.collection(COLLECTIONS.envases).doc(detail.envaseTipoId);
        const movementRef = envaseRef.collection("movimientos").doc();
        const stockDelta = config.deltaSign * detail.cantidad;

        if (!movimientoId) {
          movimientoId = movementRef.id;
        }

        transaction.create(movementRef, {
          operacionId: operacionRef.id,
          envaseTipoId: detail.envaseTipoId,
          envaseTipoCodigo: detail.envaseTipoCodigo,
          envaseTipoNombre: detail.envaseTipoNombre,
          tipoMovimiento: config.movimiento,
          origen: config.origen,
          cantidadEnvases: detail.cantidad,
          deltaEnvases: stockDelta,
          fechaOperacion: timestampOperacion,
          ...fechaKeys,
          cliente,
          clienteNormalizado,
          proveedor,
          proveedorNormalizado,
          proceso,
          procesoNormalizado,
          procedencia,
          procedenciaNormalizada,
          ...(destinatario
            ? {
                destinatario,
                destinatarioNormalizado
              }
            : {}),
          envaseEstado: detail.envaseEstado,
          producto,
          productoNormalizado,
          cartaPorteNumero: numeroCartaPorte,
          observaciones,
          createdAt: now,
          createdBy: actorId,
          updatedBy: actorId
        });

        const currentUpdate = stockUpdates.get(detail.envaseTipoId);

        if (currentUpdate) {
          currentUpdate.stockDelta += stockDelta;
          currentUpdate.ingresosDelta +=
            input.tipoOperacion === "ingreso" ? detail.cantidad : 0;
          currentUpdate.egresosDelta +=
            input.tipoOperacion === "egreso" ? detail.cantidad : 0;
          currentUpdate.lastMovimientoId = movementRef.id;
          continue;
        }

        stockUpdates.set(detail.envaseTipoId, {
          envaseRef,
          envase: detail.envase,
          existsInNuevaColeccion: detail.existsInNuevaColeccion,
          stockDelta,
          ingresosDelta: input.tipoOperacion === "ingreso" ? detail.cantidad : 0,
          egresosDelta: input.tipoOperacion === "egreso" ? detail.cantidad : 0,
          lastMovimientoId: movementRef.id
        });
      }

      for (const update of stockUpdates.values()) {
        if (update.existsInNuevaColeccion) {
          transaction.set(
            update.envaseRef,
            {
              stockActual: FieldValue.increment(update.stockDelta),
              ingresosAcumulados: FieldValue.increment(update.ingresosDelta),
              egresosAcumulados: FieldValue.increment(update.egresosDelta),
              updatedAt: now,
              updatedBy: actorId,
              lastMovimientoId: update.lastMovimientoId,
              version: FieldValue.increment(1)
            },
            { merge: true }
          );
          continue;
        }

        transaction.set(
          update.envaseRef,
          {
            codigo: update.envase.codigo,
            nombre: update.envase.nombre,
            descripcion: update.envase.descripcion ?? "",
            controlaStock: update.envase.controlaStock,
            activo: update.envase.activo,
            orden: update.envase.orden,
            stockActual: update.envase.stockActual + update.stockDelta,
            ingresosAcumulados:
              update.envase.ingresosAcumulados + update.ingresosDelta,
            egresosAcumulados:
              update.envase.egresosAcumulados + update.egresosDelta,
            ajustesAcumulados: update.envase.ajustesAcumulados,
            createdAt: now,
            updatedAt: now,
            createdBy: actorId,
            updatedBy: actorId,
            lastMovimientoId: update.lastMovimientoId,
            version: update.envase.version + 1
          },
          { merge: true }
        );
      }

      transaction.create(uniqueKeyRef, {
        operacionId: operacionRef.id,
        tipoOperacion: input.tipoOperacion,
        collection: config.collection,
        numeroCartaPorte,
        numeroCartaPorteNormalizado,
        createdAt: now
      });

      transaction.create(operacionRef, {
        ...(legacyDescargaPayload ?? {}),
        tipoOperacion: input.tipoOperacion,
        fechaOperacion: timestampOperacion,
        ...fechaKeys,
        numeroCartaPorte,
        numeroCartaPorteNormalizado,
        cliente,
        clienteNormalizado,
        proveedor,
        proveedorNormalizado,
        proceso,
        procesoNormalizado,
        procedencia,
        procedenciaNormalizada,
        ...(destinatario
          ? {
              destinatario,
              destinatarioNormalizado
            }
          : {}),
        envaseEstado: primaryDetail.envaseEstado,
        producto,
        productoNormalizado,
        kilos: input.kilos,
        cantidadEnvases: totalCantidadEnvases,
        envaseTipoId: primaryDetail.envaseTipoId,
        envaseTipoCodigo: primaryDetail.envaseTipoCodigo,
        envaseTipoNombre: primaryDetail.envaseTipoNombre,
        envaseMode,
        detalleEnvases: persistedDetalleEnvases,
        loteEnvasadoDetalles: loteEnvasadoDetallesInput,
        ...(input.cartaPortePdf ? { cartaPortePdf: input.cartaPortePdf } : {}),
        observaciones,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
        updatedBy: actorId
      });

      transaction.set(
        resumenDiarioRef,
        {
          ...fechaKeys,
          [config.totalOperacionesField]: FieldValue.increment(1),
          [config.totalKilosField]: FieldValue.increment(input.kilos),
          [config.totalEnvasesField]: FieldValue.increment(totalCantidadEnvases),
          updatedAt: now
        },
        { merge: true }
      );
    });

    return {
      ok: true,
      message: config.successMessage,
      data: {
        operacionId: operacionRef.id,
        movimientoId
      }
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : OPERACION_CONFIG[input.tipoOperacion].failureMessage
    };
  }
}

async function crearOperacionIngresoCompat(
  input: OperacionIngresoPersistenciaInput,
  actorUid?: string
): Promise<ActionState<CrearOperacionData>> {
  const db = getAdminDb();
  const actorId = actorUid?.trim() || DEFAULT_FIRESTORE_ACTOR;
  const cliente = compactarEspacios(input.cliente);
  const proveedor = compactarEspacios(input.proveedor);
  const proceso = compactarEspacios(input.proceso);
  const producto = compactarEspacios(input.producto ?? input.proceso);
  const observaciones = input.observaciones
    ? compactarEspacios(input.observaciones)
    : null;
  const timestampOperacion = Timestamp.fromDate(
    fechaIsoLocalToDate(input.fechaOperacion)
  );
  const now = Timestamp.now();
  const nowMs = now.toMillis();
  const operacionId = crearIdDescargaLegacy(nowMs);
  const detalleEnvasesInput = buildOperacionEnvaseInputs(input);
  const operacionRef = db.collection(COLLECTIONS.descargas).doc(operacionId);
  const numeroCartaPorteInformado = compactarEspacios(input.numeroCartaPorte);
  const numeroCartaPorte =
    numeroCartaPorteInformado && !numeroCartaPorteInformado.startsWith("MANUAL-")
      ? numeroCartaPorteInformado
      : "";

  try {
    let movimientoId: string | null = null;

    await db.runTransaction(async (transaction) => {
      const uniqueEnvaseIds = [
        ...new Set(detalleEnvasesInput.map((detail) => detail.envaseTipoId))
      ];
      const envasesResolved = new Map<string, EnvaseTransactionResult>();

      await Promise.all(
        uniqueEnvaseIds.map(async (envaseId) => {
          const envaseRef = db.collection(COLLECTIONS.envases).doc(envaseId);
          const legacyTipoRef = db.collection(COLLECTIONS.envaseTipos).doc(envaseId);
          const legacyStockRef = db.collection(COLLECTIONS.envaseStock).doc(envaseId);
          const [envaseSnap, legacyTipoSnap, legacyStockSnap] = await Promise.all([
            transaction.get(envaseRef),
            transaction.get(legacyTipoRef),
            transaction.get(legacyStockRef)
          ]);
          const envaseResult = getEnvaseForTransaction(
            envaseId,
            envaseSnap,
            legacyTipoSnap,
            legacyStockSnap
          );

          if (!envaseResult) {
            throw new Error("Uno de los envases seleccionados no existe.");
          }

          if (envaseResult.envase.activo === false) {
            throw new Error(
              `El envase ${envaseResult.envase.nombre} esta inactivo y no puede utilizarse.`
            );
          }

          envasesResolved.set(envaseId, envaseResult);
        })
      );

      const detalleEnvases = detalleEnvasesInput.map((detail) => {
        const envaseResult = envasesResolved.get(detail.envaseTipoId);

        if (!envaseResult) {
          throw new Error("No fue posible resolver el detalle de envases.");
        }

        return {
          inventoryId:
            compactarEspacios(detail.inventoryId ?? "") ||
            getInventoryIdForDetail({
              envaseTipoId: detail.envaseTipoId,
              envaseEstado: detail.envaseEstado,
              kilos: detail.kilos,
            }),
          envaseTipoId: detail.envaseTipoId,
          envaseTipoCodigo: envaseResult.envase.codigo,
          envaseTipoNombre: envaseResult.envase.nombre,
          envaseEstado: detail.envaseEstado,
          kilos: detail.kilos,
          cantidad: detail.cantidad,
          envase: envaseResult.envase,
          existsInNuevaColeccion: envaseResult.existsInNuevaColeccion
        } satisfies OperacionEnvaseResolved;
      });

      const stockUpdates = new Map<
        string,
        {
          envaseRef: FirebaseFirestore.DocumentReference;
          envase: EnvaseTransactionResult["envase"];
          existsInNuevaColeccion: boolean;
          stockDelta: number;
          ingresosDelta: number;
          lastMovimientoId: string;
        }
      >();

      for (const detail of detalleEnvases) {
        if (detail.envase.controlaStock === false) {
          continue;
        }

        const envaseRef = db.collection(COLLECTIONS.envases).doc(detail.envaseTipoId);
        const movementRef = envaseRef.collection("movimientos").doc();

        if (!movimientoId) {
          movimientoId = movementRef.id;
        }

        transaction.create(movementRef, {
          operacionId,
          envaseTipoId: detail.envaseTipoId,
          envaseTipoCodigo: detail.envaseTipoCodigo,
          envaseTipoNombre: detail.envaseTipoNombre,
          tipoMovimiento: "ingreso",
          origen: "operacion_ingreso",
          cantidadEnvases: detail.cantidad,
          deltaEnvases: detail.cantidad,
          fechaOperacion: timestampOperacion,
          ...construirClavesFecha(input.fechaOperacion),
          cliente,
          clienteNormalizado: normalizarTextoParaIndice(cliente),
          proveedor,
          proveedorNormalizado: normalizarTextoParaIndice(proveedor),
          proceso,
          procesoNormalizado: normalizarTextoParaIndice(proceso),
          procedencia: proveedor,
          procedenciaNormalizada: normalizarTextoParaIndice(proveedor),
          envaseEstado: detail.envaseEstado,
          producto,
          productoNormalizado: normalizarTextoParaIndice(producto),
          cartaPorteNumero: numeroCartaPorte,
          observaciones,
          createdAt: now,
          createdBy: actorId,
          updatedBy: actorId
        });

        const currentUpdate = stockUpdates.get(detail.envaseTipoId);

        if (currentUpdate) {
          currentUpdate.stockDelta += detail.cantidad;
          currentUpdate.ingresosDelta += detail.cantidad;
          currentUpdate.lastMovimientoId = movementRef.id;
          continue;
        }

        stockUpdates.set(detail.envaseTipoId, {
          envaseRef,
          envase: detail.envase,
          existsInNuevaColeccion: detail.existsInNuevaColeccion,
          stockDelta: detail.cantidad,
          ingresosDelta: detail.cantidad,
          lastMovimientoId: movementRef.id
        });
      }

      for (const update of stockUpdates.values()) {
        if (update.existsInNuevaColeccion) {
          transaction.set(
            update.envaseRef,
            {
              stockActual: FieldValue.increment(update.stockDelta),
              ingresosAcumulados: FieldValue.increment(update.ingresosDelta),
              updatedAt: now,
              updatedBy: actorId,
              lastMovimientoId: update.lastMovimientoId,
              version: FieldValue.increment(1)
            },
            { merge: true }
          );
          continue;
        }

        transaction.set(
          update.envaseRef,
          {
            codigo: update.envase.codigo,
            nombre: update.envase.nombre,
            descripcion: update.envase.descripcion ?? "",
            controlaStock: update.envase.controlaStock,
            activo: update.envase.activo,
            orden: update.envase.orden,
            stockActual: update.envase.stockActual + update.stockDelta,
            ingresosAcumulados:
              update.envase.ingresosAcumulados + update.ingresosDelta,
            egresosAcumulados: update.envase.egresosAcumulados,
            ajustesAcumulados: update.envase.ajustesAcumulados,
            createdAt: now,
            updatedAt: now,
            createdBy: actorId,
            updatedBy: actorId,
            lastMovimientoId: update.lastMovimientoId,
            version: update.envase.version + 1
          },
          { merge: true }
        );
      }

      transaction.create(
        operacionRef,
        buildLegacyDescargaDocumentPayload({
          operacionId,
          input,
          actorId,
          now,
          nowMs,
          detalleEnvases,
          cartaPortePdf: input.cartaPortePdf
        })
      );
    });

    return {
      ok: true,
      message: OPERACION_CONFIG.ingreso.successMessage,
      data: {
        operacionId,
        movimientoId
      }
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : OPERACION_CONFIG.ingreso.failureMessage
    };
  }
}

export async function crearOperacionIngreso(
  rawInput: unknown,
  actorUid?: string
): Promise<ActionState<CrearOperacionData>> {
  const parsedInput = operacionIngresoPersistenciaSchema.safeParse(rawInput);

  if (!parsedInput.success) {
    return {
      ok: false,
      message: "La descarga no paso la validacion de dominio.",
      fieldErrors: parsedInput.error.flatten().fieldErrors
    };
  }

  return crearOperacionIngresoCompat(parsedInput.data, actorUid);
}

export async function actualizarOperacionIngreso(
  operacionId: string,
  rawInput: unknown,
  actorUid?: string
): Promise<ActionState<OperacionMutationData>> {
  const parsedInput = operacionIngresoPersistenciaSchema.safeParse(rawInput);

  if (!parsedInput.success) {
    return {
      ok: false,
      message: "La descarga no paso la validacion de dominio.",
      fieldErrors: parsedInput.error.flatten().fieldErrors
    };
  }

  const safeOperacionId = compactarEspacios(operacionId);

  if (!safeOperacionId) {
    return {
      ok: false,
      message: "La descarga indicada no es valida."
    };
  }

  const db = getAdminDb();
  const actorId = actorUid?.trim() || DEFAULT_FIRESTORE_ACTOR;
  const input = parsedInput.data;
  const now = Timestamp.now();
  const nowMs = now.toMillis();
  const operacionRef = db.collection(COLLECTIONS.descargas).doc(safeOperacionId);

  try {
    await db.runTransaction(async (transaction) => {
      const operacionSnap = await transaction.get(operacionRef);

      if (!operacionSnap.exists) {
        throw new Error("La descarga que intenta editar ya no existe.");
      }

      const existingData = operacionSnap.data() ?? {};
      const detalleEnvasesInput = buildOperacionEnvaseInputs(input);
      const uniqueEnvaseIds = [
        ...new Set(detalleEnvasesInput.map((detail) => detail.envaseTipoId))
      ];
      const storedDetalleEnvases = getStoredDetalleEnvases(existingData);
      const envasesResolved = new Map<string, EnvaseTransactionResult>();

      await Promise.all(
        uniqueEnvaseIds.map(async (envaseId) => {
          const envaseRef = db.collection(COLLECTIONS.envases).doc(envaseId);
          const legacyTipoRef = db.collection(COLLECTIONS.envaseTipos).doc(envaseId);
          const legacyStockRef = db.collection(COLLECTIONS.envaseStock).doc(envaseId);
          const [envaseSnap, legacyTipoSnap, legacyStockSnap] = await Promise.all([
            transaction.get(envaseRef),
            transaction.get(legacyTipoRef),
            transaction.get(legacyStockRef)
          ]);
          const envaseResult = getEnvaseForTransaction(
            envaseId,
            envaseSnap,
            legacyTipoSnap,
            legacyStockSnap
          );

          if (!envaseResult) {
            throw new Error("Uno de los envases seleccionados no existe.");
          }

          if (envaseResult.envase.activo === false) {
            throw new Error(
              `El envase ${envaseResult.envase.nombre} esta inactivo y no puede utilizarse.`
            );
          }

          envasesResolved.set(envaseId, envaseResult);
        })
      );

      const movementLookupIds = [
        ...new Set([
          ...uniqueEnvaseIds,
          ...storedDetalleEnvases.map((detail) => detail.envaseTipoId),
          ...(typeof existingData.envaseTipoId === "string"
            ? [compactarEspacios(existingData.envaseTipoId)]
            : []),
        ])
      ];
      const existingMovementDocs = await getOperacionMovementDocs(
        transaction,
        db,
        safeOperacionId,
        movementLookupIds,
      );
      const reverseStockUpdates = new Map<
        string,
        {
          envaseRef: FirebaseFirestore.DocumentReference;
          stockDelta: number;
          ingresosDelta: number;
          egresosDelta: number;
        }
      >();

      for (const movimientoDocumento of existingMovementDocs) {
        const movimientoData = movimientoDocumento.data();
        const envaseRef = movimientoDocumento.ref.parent.parent;

        if (!envaseRef) {
          transaction.delete(movimientoDocumento.ref);
          continue;
        }

        const stockBase =
          getNumericValue(movimientoData, ["deltaEnvases", "cantidadEnvases"]) || 0;
        const cantidadBase =
          getNumericValue(movimientoData, ["cantidadEnvases", "deltaEnvases"]) || 0;
        const tipoMovimiento =
          typeof movimientoData.tipoMovimiento === "string"
            ? movimientoData.tipoMovimiento
            : "ingreso";
        const currentUpdate = reverseStockUpdates.get(envaseRef.path) ?? {
          envaseRef,
          stockDelta: 0,
          ingresosDelta: 0,
          egresosDelta: 0
        };

        if (tipoMovimiento === "ingreso") {
          currentUpdate.stockDelta -= Math.abs(stockBase);
          currentUpdate.ingresosDelta -= Math.abs(cantidadBase);
        } else if (tipoMovimiento === "egreso") {
          currentUpdate.stockDelta += Math.abs(stockBase);
          currentUpdate.egresosDelta -= Math.abs(cantidadBase);
        }

        reverseStockUpdates.set(envaseRef.path, currentUpdate);
        transaction.delete(movimientoDocumento.ref);
      }

      for (const update of reverseStockUpdates.values()) {
        applyLegacyIngresoStockDelta(transaction, update.envaseRef, update, actorId, now);
      }

      const detalleEnvases = detalleEnvasesInput.map((detail) => {
        const envaseResult = envasesResolved.get(detail.envaseTipoId);

        if (!envaseResult) {
          throw new Error("No fue posible resolver el detalle de envases.");
        }

        return {
          inventoryId:
            compactarEspacios(detail.inventoryId ?? "") ||
            getInventoryIdForDetail({
              envaseTipoId: detail.envaseTipoId,
              envaseEstado: detail.envaseEstado,
              kilos: detail.kilos,
            }),
          envaseTipoId: detail.envaseTipoId,
          envaseTipoCodigo: envaseResult.envase.codigo,
          envaseTipoNombre: envaseResult.envase.nombre,
          envaseEstado: detail.envaseEstado,
          kilos: detail.kilos,
          cantidad: detail.cantidad,
          envase: envaseResult.envase,
          existsInNuevaColeccion: envaseResult.existsInNuevaColeccion
        } satisfies OperacionEnvaseResolved;
      });

      const stockUpdates = new Map<
        string,
        {
          envaseRef: FirebaseFirestore.DocumentReference;
          envase: EnvaseTransactionResult["envase"];
          existsInNuevaColeccion: boolean;
          stockDelta: number;
          ingresosDelta: number;
          lastMovimientoId: string;
        }
      >();

      for (const detail of detalleEnvases) {
        if (detail.envase.controlaStock === false) {
          continue;
        }

        const envaseRef = db.collection(COLLECTIONS.envases).doc(detail.envaseTipoId);
        const movementRef = envaseRef.collection("movimientos").doc();

        transaction.create(movementRef, {
          operacionId: safeOperacionId,
          envaseTipoId: detail.envaseTipoId,
          envaseTipoCodigo: detail.envaseTipoCodigo,
          envaseTipoNombre: detail.envaseTipoNombre,
          tipoMovimiento: "ingreso",
          origen: "operacion_ingreso",
          cantidadEnvases: detail.cantidad,
          deltaEnvases: detail.cantidad,
          fechaOperacion: Timestamp.fromDate(fechaIsoLocalToDate(input.fechaOperacion)),
          ...construirClavesFecha(input.fechaOperacion),
          cliente: compactarEspacios(input.cliente),
          clienteNormalizado: normalizarTextoParaIndice(compactarEspacios(input.cliente)),
          proveedor: compactarEspacios(input.proveedor),
          proveedorNormalizado: normalizarTextoParaIndice(compactarEspacios(input.proveedor)),
          proceso: compactarEspacios(input.proceso),
          procesoNormalizado: normalizarTextoParaIndice(compactarEspacios(input.proceso)),
          procedencia: compactarEspacios(input.proveedor),
          procedenciaNormalizada: normalizarTextoParaIndice(compactarEspacios(input.proveedor)),
          envaseEstado: detail.envaseEstado,
          producto: compactarEspacios(input.producto ?? input.proceso),
          productoNormalizado: normalizarTextoParaIndice(
            compactarEspacios(input.producto ?? input.proceso)
          ),
          cartaPorteNumero: compactarEspacios(input.numeroCartaPorte),
          observaciones: input.observaciones
            ? compactarEspacios(input.observaciones)
            : null,
          createdAt: now,
          createdBy: actorId,
          updatedBy: actorId
        });

        const currentUpdate = stockUpdates.get(detail.envaseTipoId);

        if (currentUpdate) {
          currentUpdate.stockDelta += detail.cantidad;
          currentUpdate.ingresosDelta += detail.cantidad;
          currentUpdate.lastMovimientoId = movementRef.id;
          continue;
        }

        stockUpdates.set(detail.envaseTipoId, {
          envaseRef,
          envase: detail.envase,
          existsInNuevaColeccion: detail.existsInNuevaColeccion,
          stockDelta: detail.cantidad,
          ingresosDelta: detail.cantidad,
          lastMovimientoId: movementRef.id
        });
      }

      for (const update of stockUpdates.values()) {
        if (update.existsInNuevaColeccion) {
          transaction.set(
            update.envaseRef,
            {
              stockActual: FieldValue.increment(update.stockDelta),
              ingresosAcumulados: FieldValue.increment(update.ingresosDelta),
              updatedAt: now,
              updatedBy: actorId,
              lastMovimientoId: update.lastMovimientoId,
              version: FieldValue.increment(1)
            },
            { merge: true }
          );
          continue;
        }

        transaction.set(
          update.envaseRef,
          {
            codigo: update.envase.codigo,
            nombre: update.envase.nombre,
            descripcion: update.envase.descripcion ?? "",
            controlaStock: update.envase.controlaStock,
            activo: update.envase.activo,
            orden: update.envase.orden,
            stockActual: update.envase.stockActual + update.stockDelta,
            ingresosAcumulados:
              update.envase.ingresosAcumulados + update.ingresosDelta,
            egresosAcumulados: update.envase.egresosAcumulados,
            ajustesAcumulados: update.envase.ajustesAcumulados,
            createdAt: now,
            updatedAt: now,
            createdBy: actorId,
            updatedBy: actorId,
            lastMovimientoId: update.lastMovimientoId,
            version: update.envase.version + 1
          },
          { merge: true }
        );
      }

      const previousNumeroCartaPorte =
        existingData && typeof existingData.numeroCartaPorte === "string"
          ? compactarEspacios(existingData.numeroCartaPorte)
          : "";

      if (previousNumeroCartaPorte) {
        const uniqueKeyRef = db
          .collection(COLLECTIONS.operacionesKeys)
          .doc(`descarga:${normalizarTextoParaIndice(previousNumeroCartaPorte)}`);
        transaction.delete(uniqueKeyRef);
      }

      transaction.set(
        operacionRef,
        buildLegacyDescargaDocumentPayload({
          operacionId: safeOperacionId,
          input,
          actorId,
          now,
          nowMs,
          detalleEnvases,
          existingData
        })
      );
    });

    return {
      ok: true,
      message: "La descarga fue actualizada.",
      data: {
        operacionId: safeOperacionId
      }
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "No fue posible actualizar la descarga."
    };
  }
}

export async function eliminarOperacionIngreso(
  operacionId: string,
  actorUid?: string
): Promise<ActionState<OperacionMutationData>> {
  const safeOperacionId = compactarEspacios(operacionId);

  if (!safeOperacionId) {
    return {
      ok: false,
      message: "La descarga indicada no es valida."
    };
  }

  const db = getAdminDb();
  const actorId = actorUid?.trim() || DEFAULT_FIRESTORE_ACTOR;
  const now = Timestamp.now();
  let storagePath: string | null = null;
  const operacionRef = db.collection(COLLECTIONS.descargas).doc(safeOperacionId);

  try {
    await db.runTransaction(async (transaction) => {
      const operacionSnap = await transaction.get(operacionRef);

      if (!operacionSnap.exists) {
        throw new Error("La descarga que intenta eliminar ya no existe.");
      }

      const existingData = operacionSnap.data() ?? {};
      storagePath = getCartaPorteStoragePath(existingData);

      const existingMovementQuery = db
        .collectionGroup("movimientos")
        .where("operacionId", "==", safeOperacionId);
      const existingMovementSnap = await transaction.get(existingMovementQuery);
      const reverseStockUpdates = new Map<
        string,
        {
          envaseRef: FirebaseFirestore.DocumentReference;
          stockDelta: number;
          ingresosDelta: number;
          egresosDelta: number;
        }
      >();

      for (const movimientoDocumento of existingMovementSnap.docs) {
        const movimientoData = movimientoDocumento.data();
        const envaseRef = movimientoDocumento.ref.parent.parent;

        if (!envaseRef) {
          transaction.delete(movimientoDocumento.ref);
          continue;
        }

        const stockBase =
          getNumericValue(movimientoData, ["deltaEnvases", "cantidadEnvases"]) || 0;
        const cantidadBase =
          getNumericValue(movimientoData, ["cantidadEnvases", "deltaEnvases"]) || 0;
        const tipoMovimiento =
          typeof movimientoData.tipoMovimiento === "string"
            ? movimientoData.tipoMovimiento
            : "ingreso";
        const currentUpdate = reverseStockUpdates.get(envaseRef.path) ?? {
          envaseRef,
          stockDelta: 0,
          ingresosDelta: 0,
          egresosDelta: 0
        };

        if (tipoMovimiento === "ingreso") {
          currentUpdate.stockDelta -= Math.abs(stockBase);
          currentUpdate.ingresosDelta -= Math.abs(cantidadBase);
        } else if (tipoMovimiento === "egreso") {
          currentUpdate.stockDelta += Math.abs(stockBase);
          currentUpdate.egresosDelta -= Math.abs(cantidadBase);
        }

        reverseStockUpdates.set(envaseRef.path, currentUpdate);
        transaction.delete(movimientoDocumento.ref);
      }

      for (const update of reverseStockUpdates.values()) {
        applyLegacyIngresoStockDelta(transaction, update.envaseRef, update, actorId, now);
      }

      const previousNumeroCartaPorte =
        existingData && typeof existingData.numeroCartaPorte === "string"
          ? compactarEspacios(existingData.numeroCartaPorte)
          : "";

      if (previousNumeroCartaPorte) {
        const uniqueKeyRef = db
          .collection(COLLECTIONS.operacionesKeys)
          .doc(`descarga:${normalizarTextoParaIndice(previousNumeroCartaPorte)}`);
        transaction.delete(uniqueKeyRef);
      }

      transaction.delete(operacionRef);
    });

    if (storagePath) {
      await eliminarCartaDePorte(storagePath).catch(() => undefined);
    }

    return {
      ok: true,
      message: "La descarga fue eliminada.",
      data: {
        operacionId: safeOperacionId
      }
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "No fue posible eliminar la descarga."
    };
  }
}

export async function actualizarOperacionEgreso(
  operacionId: string,
  rawInput: unknown,
  actorUid?: string
): Promise<ActionState<OperacionMutationData>> {
  const parsedInput = operacionEgresoFormSchema
    .extend({
      cartaPortePdf: cartaPorteArchivoSchema.optional()
    })
    .safeParse(rawInput);

  if (!parsedInput.success) {
    return {
      ok: false,
      message: "La carga no paso la validacion de dominio.",
      fieldErrors: parsedInput.error.flatten().fieldErrors
    };
  }

  const safeOperacionId = compactarEspacios(operacionId);

  if (!safeOperacionId) {
    return {
      ok: false,
      message: "La carga indicada no es valida."
    };
  }

  const input: OperacionEgresoUpdateInput = parsedInput.data;
  const config = OPERACION_CONFIG.egreso;
  const db = getAdminDb();
  const actorId = actorUid?.trim() || DEFAULT_FIRESTORE_ACTOR;
  const now = Timestamp.now();
  const fechaKeys = construirClavesFecha(input.fechaOperacion);
  const timestampOperacion = Timestamp.fromDate(
    new Date(`${input.fechaOperacion}T00:00:00.000Z`)
  );
  const cliente = compactarEspacios(input.cliente);
  const proveedor = compactarEspacios(input.proveedor || input.procedencia);
  const proceso = compactarEspacios(input.proceso);
  const procedencia = compactarEspacios(input.procedencia || input.proveedor);
  const destinatario = compactarEspacios(input.destinatario ?? "");
  const producto = compactarEspacios(input.producto ?? input.proceso);
  const envaseMode = normalizeEnvaseMode(input.envaseMode);
  const allowStockInsuficiente = input.confirmarStockInsuficiente === true;
  const observaciones = input.observaciones
    ? compactarEspacios(input.observaciones)
    : null;
  const numeroCartaPorte = compactarEspacios(input.numeroCartaPorte);
  const numeroCartaPorteNormalizado = normalizarTextoParaIndice(numeroCartaPorte);
  const clienteNormalizado = normalizarTextoParaIndice(cliente);
  const proveedorNormalizado = normalizarTextoParaIndice(proveedor);
  const procesoNormalizado = normalizarTextoParaIndice(proceso);
  const procedenciaNormalizada = normalizarTextoParaIndice(procedencia);
  const destinatarioNormalizado = normalizarTextoParaIndice(destinatario);
  const productoNormalizado = normalizarTextoParaIndice(producto);
  const operacionRef = db.collection(config.collection).doc(safeOperacionId);
  const nextUniqueKeyRef = db
    .collection(COLLECTIONS.operacionesKeys)
    .doc(`${config.keyPrefix}__${numeroCartaPorteNormalizado}`);

  try {
    await db.runTransaction(async (transaction) => {
      const operacionSnap = await transaction.get(operacionRef);

      if (!operacionSnap.exists) {
        throw new Error("La carga que intenta editar ya no existe.");
      }

      const existingData = operacionSnap.data() ?? {};
      const storedDetalleEnvases = getStoredDetalleEnvases(existingData);
      const detalleEnvasesInput =
        envaseMode === "manual"
          ? buildOperacionEnvaseInputs({
              ...input,
              cartaPortePdf: input.cartaPortePdf ?? existingData.cartaPortePdf
            })
          : [];
      const loteEnvasadoDetallesInput =
        envaseMode === "manual"
          ? []
          : buildStoredLotInputs({
              ...input,
              cartaPortePdf: input.cartaPortePdf ?? existingData.cartaPortePdf
            });
      const uniqueEnvaseIds = [
        ...new Set(detalleEnvasesInput.map((detail) => detail.envaseTipoId))
      ];
      const previousNumeroCartaPorte =
        typeof existingData.numeroCartaPorte === "string"
          ? compactarEspacios(existingData.numeroCartaPorte)
          : "";
      const previousNumeroCartaPorteNormalizado =
        typeof existingData.numeroCartaPorteNormalizado === "string"
          ? compactarEspacios(existingData.numeroCartaPorteNormalizado)
          : normalizarTextoParaIndice(previousNumeroCartaPorte);
      const previousUniqueKeyRef = db
        .collection(COLLECTIONS.operacionesKeys)
        .doc(`${config.keyPrefix}__${previousNumeroCartaPorteNormalizado}`);
      const nextUniqueKeySnap = await transaction.get(nextUniqueKeyRef);
      const envasesResolved = new Map<string, EnvaseTransactionResult>();

      await Promise.all(
        uniqueEnvaseIds.map(async (envaseId) => {
          const envaseRef = db.collection(COLLECTIONS.envases).doc(envaseId);
          const legacyTipoRef = db.collection(COLLECTIONS.envaseTipos).doc(envaseId);
          const legacyStockRef = db.collection(COLLECTIONS.envaseStock).doc(envaseId);
          const [envaseSnap, legacyTipoSnap, legacyStockSnap] = await Promise.all([
            transaction.get(envaseRef),
            transaction.get(legacyTipoRef),
            transaction.get(legacyStockRef)
          ]);
          const envaseResult = getEnvaseForTransaction(
            envaseId,
            envaseSnap,
            legacyTipoSnap,
            legacyStockSnap
          );

          if (!envaseResult) {
            throw new Error("Uno de los envases seleccionados no existe.");
          }

          if (envaseResult.envase.activo === false) {
            throw new Error(
              `El envase ${envaseResult.envase.nombre} esta inactivo y no puede utilizarse.`
            );
          }

          envasesResolved.set(envaseId, envaseResult);
        })
      );

      if (
        nextUniqueKeyRef.path !== previousUniqueKeyRef.path &&
        nextUniqueKeySnap.exists
      ) {
        throw new Error(`Ya existe un registro para la referencia ${numeroCartaPorte}.`);
      }

      const movementLookupIds = [
        ...new Set([
          ...uniqueEnvaseIds,
          ...storedDetalleEnvases.map((detail) => detail.envaseTipoId)
        ])
      ];
      const existingMovementDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];

      for (const envaseId of movementLookupIds) {
        const existingMovementSnap = await transaction.get(
          db
            .collection(COLLECTIONS.envases)
            .doc(envaseId)
            .collection("movimientos")
            .where("operacionId", "==", safeOperacionId)
        );

        existingMovementDocs.push(...existingMovementSnap.docs);
      }

      const reverseStockUpdates = new Map<
        string,
        {
          envaseRef: FirebaseFirestore.DocumentReference;
          stockDelta: number;
          ingresosDelta: number;
          egresosDelta: number;
        }
      >();
      const restoredStockByInventoryId = new Map<string, number>();

      for (const movimientoDocumento of existingMovementDocs) {
        const movimientoData = movimientoDocumento.data();
        const envaseRef = movimientoDocumento.ref.parent.parent;

        if (!envaseRef) {
          transaction.delete(movimientoDocumento.ref);
          continue;
        }

        const stockBase =
          getNumericValue(movimientoData, ["deltaEnvases", "cantidadEnvases"]) || 0;
        const cantidadBase =
          getNumericValue(movimientoData, ["cantidadEnvases", "deltaEnvases"]) || 0;
        const tipoMovimiento =
          typeof movimientoData.tipoMovimiento === "string"
            ? movimientoData.tipoMovimiento
            : "egreso";
        const currentUpdate = reverseStockUpdates.get(envaseRef.path) ?? {
          envaseRef,
          stockDelta: 0,
          ingresosDelta: 0,
          egresosDelta: 0
        };
        const envaseId =
          typeof movimientoData.envaseTipoId === "string"
            ? compactarEspacios(movimientoData.envaseTipoId)
            : "";
        const envaseEstado =
          typeof movimientoData.envaseEstado === "string"
            ? compactarEspacios(movimientoData.envaseEstado)
            : "";
        const kilosMovimiento = getNumericValue(movimientoData, ["kilos", "packagingKg"]);

        if (tipoMovimiento === "ingreso") {
          currentUpdate.stockDelta -= Math.abs(stockBase);
          currentUpdate.ingresosDelta -= Math.abs(cantidadBase);
        } else if (tipoMovimiento === "egreso") {
          currentUpdate.stockDelta += Math.abs(stockBase);
          currentUpdate.egresosDelta -= Math.abs(cantidadBase);
          if (envaseId && envaseEstado) {
            const inventoryId = getInventoryIdForDetail({
              envaseTipoId: envaseId,
              envaseEstado,
              kilos: kilosMovimiento,
            });
            restoredStockByInventoryId.set(
              inventoryId,
              (restoredStockByInventoryId.get(inventoryId) ?? 0) + Math.abs(stockBase)
            );
          }
        }

        reverseStockUpdates.set(envaseRef.path, currentUpdate);
        transaction.delete(movimientoDocumento.ref);
      }

      const requestedByInventory = new Map<string, number>();

      for (const detail of detalleEnvasesInput) {
        const inventoryId =
          compactarEspacios(detail.inventoryId) ||
          getInventoryIdForDetail({
            envaseTipoId: detail.envaseTipoId,
            envaseEstado: detail.envaseEstado,
            kilos: detail.kilos,
          });
        requestedByInventory.set(
          inventoryId,
          (requestedByInventory.get(inventoryId) ?? 0) + detail.cantidad
        );
      }

      if (envaseMode === "manual") {
        const availabilityMap = await getPlantStockAvailabilityMap();

        for (const [inventoryId, cantidadSolicitada] of requestedByInventory) {
          const availabilityEntry = availabilityMap.get(inventoryId);
          const disponibilidadAjustada =
            (availabilityEntry?.cantidad ?? 0) +
            (restoredStockByInventoryId.get(inventoryId) ?? 0);

          if (
            !allowStockInsuficiente &&
            disponibilidadAjustada < cantidadSolicitada
          ) {
            throw new Error(
              `Stock insuficiente para ${availabilityEntry?.visibleId ?? inventoryId}. Disponible: ${disponibilidadAjustada}, solicitado: ${cantidadSolicitada}.`
            );
          }
        }
      }

      if (envaseMode !== "manual") {
        const storedLots = await getStoredLotsAvailabilityForEgresos(
          transaction,
          db,
          safeOperacionId
        );
        const storedLotsById = new Map<
          string,
          {
            envaseVisibleId: string;
            cantidadDisponible: number;
            kilosDisponibles: number;
          }
        >(
          storedLots.map((lot) => [
            lot.storedItemId,
            {
              envaseVisibleId: lot.envaseVisibleId,
              cantidadDisponible: lot.cantidadDisponible,
              kilosDisponibles: lot.kilosDisponibles,
            },
          ]),
        );
        const persistedStoredLots = getStoredLoteEnvasadoDetalles(existingData);

        for (const detail of persistedStoredLots) {
          const currentValue = storedLotsById.get(detail.storedItemId);

          if (!currentValue) {
            storedLotsById.set(detail.storedItemId, {
              envaseVisibleId: detail.envaseVisibleId,
              cantidadDisponible: Number(detail.cantidad ?? 0),
              kilosDisponibles: Number(detail.kilos ?? 0),
            });
            continue;
          }

          currentValue.cantidadDisponible = Math.max(
            currentValue.cantidadDisponible,
            Number(detail.cantidad ?? 0),
          );
          currentValue.kilosDisponibles = Math.max(
            currentValue.kilosDisponibles,
            Number(detail.kilos ?? 0),
          );
        }

        for (const detail of loteEnvasadoDetallesInput) {
          const lot = storedLotsById.get(detail.storedItemId);

          if (!lot) {
            throw new Error("El lote envasado seleccionado ya no esta disponible.");
          }

          if (!allowStockInsuficiente && detail.cantidad > lot.cantidadDisponible) {
            throw new Error(
              `Stock insuficiente para ${lot.envaseVisibleId}. Disponible: ${lot.cantidadDisponible}, solicitado: ${detail.cantidad}.`
            );
          }

          if (detail.kilos > lot.kilosDisponibles) {
            throw new Error(
              `Kilos insuficientes para ${lot.envaseVisibleId}. Disponible: ${lot.kilosDisponibles}, solicitado: ${detail.kilos}.`
            );
          }
        }
      }

      for (const update of reverseStockUpdates.values()) {
        applyLegacyIngresoStockDelta(transaction, update.envaseRef, update, actorId, now);
      }

      const detalleEnvases = detalleEnvasesInput.map((detail) => {
        const envaseResult = envasesResolved.get(detail.envaseTipoId);

        if (!envaseResult) {
          throw new Error("No fue posible resolver el detalle de envases.");
        }

        return {
          inventoryId:
            compactarEspacios(detail.inventoryId ?? "") ||
            getInventoryIdForDetail({
              envaseTipoId: detail.envaseTipoId,
              envaseEstado: detail.envaseEstado,
              kilos: detail.kilos,
            }),
          envaseTipoId: detail.envaseTipoId,
          envaseTipoCodigo: envaseResult.envase.codigo,
          envaseTipoNombre:
            compactarEspacios(detail.envaseTipoNombre) || envaseResult.envase.nombre,
          envaseEstado: detail.envaseEstado,
          kilos: detail.kilos,
          cantidad: detail.cantidad,
          envase: envaseResult.envase,
          existsInNuevaColeccion: envaseResult.existsInNuevaColeccion
        } satisfies OperacionEnvaseResolved;
      });

      const persistedDetalleEnvases =
        envaseMode === "manual"
          ? buildPersistedDetalleEnvases(
              detalleEnvases,
              input.detalleEnvases
            )
          : [];
      const primaryLote = loteEnvasadoDetallesInput[0] ?? null;
      const primaryDetail = persistedDetalleEnvases[0] ?? (primaryLote
        ? {
            envaseTipoId: primaryLote.envaseTipoId,
            envaseTipoCodigo: primaryLote.envaseTipoId.toUpperCase().slice(0, 32),
            envaseTipoNombre: primaryLote.envaseTipoNombre,
            envaseEstado: primaryLote.envaseEstado,
            kilos: primaryLote.pesoEnvaseKg,
            cantidad: primaryLote.cantidad,
          }
        : {
        envaseTipoId: SIN_ENVASE_TIPO_ID,
        envaseTipoCodigo: SIN_ENVASE_TIPO_CODE,
        envaseTipoNombre: SIN_ENVASE_TIPO_NOMBRE,
        envaseEstado: SIN_ENVASE_ESTADO,
        kilos: 0,
        cantidad: 0
      });
      const totalCantidadEnvases =
        envaseMode === "manual"
          ? persistedDetalleEnvases.reduce(
              (total, detail) => total + Number(detail.cantidad ?? 0),
              0
            )
          : loteEnvasadoDetallesInput.reduce(
              (total, detail) => total + Number(detail.cantidad ?? 0),
              0
            );
      const stockUpdates = new Map<
        string,
        {
          envaseRef: FirebaseFirestore.DocumentReference;
          envase: EnvaseTransactionResult["envase"];
          existsInNuevaColeccion: boolean;
          stockDelta: number;
          ingresosDelta: number;
          egresosDelta: number;
          lastMovimientoId: string;
        }
      >();

      for (const detail of detalleEnvases) {
        if (detail.envase.controlaStock === false) {
          continue;
        }

        const envaseRef = db.collection(COLLECTIONS.envases).doc(detail.envaseTipoId);
        const movementRef = envaseRef.collection("movimientos").doc();
        const stockDelta = config.deltaSign * detail.cantidad;

        transaction.create(movementRef, {
          operacionId: safeOperacionId,
          envaseTipoId: detail.envaseTipoId,
          envaseTipoCodigo: detail.envaseTipoCodigo,
          envaseTipoNombre: detail.envaseTipoNombre,
          tipoMovimiento: config.movimiento,
          origen: config.origen,
          cantidadEnvases: detail.cantidad,
          deltaEnvases: stockDelta,
          fechaOperacion: timestampOperacion,
          ...fechaKeys,
          cliente,
          clienteNormalizado,
          proveedor,
          proveedorNormalizado,
          proceso,
          procesoNormalizado,
          procedencia,
          procedenciaNormalizada,
          ...(destinatario
            ? {
                destinatario,
                destinatarioNormalizado
              }
            : {}),
          envaseEstado: detail.envaseEstado,
          producto,
          productoNormalizado,
          cartaPorteNumero: numeroCartaPorte,
          observaciones,
          createdAt: now,
          createdBy: actorId,
          updatedBy: actorId
        });

        const currentUpdate = stockUpdates.get(detail.envaseTipoId);

        if (currentUpdate) {
          currentUpdate.stockDelta += stockDelta;
          currentUpdate.egresosDelta += detail.cantidad;
          currentUpdate.lastMovimientoId = movementRef.id;
          continue;
        }

        stockUpdates.set(detail.envaseTipoId, {
          envaseRef,
          envase: detail.envase,
          existsInNuevaColeccion: detail.existsInNuevaColeccion,
          stockDelta,
          ingresosDelta: 0,
          egresosDelta: detail.cantidad,
          lastMovimientoId: movementRef.id
        });
      }

      for (const update of stockUpdates.values()) {
        applyLegacyIngresoStockDelta(transaction, update.envaseRef, update, actorId, now);
      }

      if (nextUniqueKeyRef.path !== previousUniqueKeyRef.path) {
        transaction.delete(previousUniqueKeyRef);
      }

      transaction.set(
        nextUniqueKeyRef,
        {
          operacionId: safeOperacionId,
          tipoOperacion: input.tipoOperacion,
          collection: config.collection,
          numeroCartaPorte,
          numeroCartaPorteNormalizado,
          createdAt:
            existingData.createdAt instanceof Timestamp ? existingData.createdAt : now
        },
        { merge: true }
      );

      transaction.set(
        operacionRef,
        {
          tipoOperacion: input.tipoOperacion,
          fechaOperacion: timestampOperacion,
          ...fechaKeys,
          numeroCartaPorte,
          numeroCartaPorteNormalizado,
          cliente,
          clienteNormalizado,
          proveedor,
          proveedorNormalizado,
          proceso,
          procesoNormalizado,
          procedencia,
          procedenciaNormalizada,
          destinatario,
          destinatarioNormalizado,
          envaseEstado: primaryDetail.envaseEstado,
          producto,
          productoNormalizado,
          kilos: input.kilos,
          cantidadEnvases: totalCantidadEnvases,
          envaseTipoId: primaryDetail.envaseTipoId,
          envaseTipoCodigo: primaryDetail.envaseTipoCodigo,
          envaseTipoNombre: primaryDetail.envaseTipoNombre,
          envaseMode,
          detalleEnvases: persistedDetalleEnvases,
          loteEnvasadoDetalles: loteEnvasadoDetallesInput,
          ...(input.cartaPortePdf
            ? { cartaPortePdf: input.cartaPortePdf }
            : existingData.cartaPortePdf
              ? { cartaPortePdf: existingData.cartaPortePdf }
              : {}),
          observaciones,
          createdAt:
            existingData.createdAt instanceof Timestamp ? existingData.createdAt : now,
          updatedAt: now,
          createdBy:
            typeof existingData.createdBy === "string" ? existingData.createdBy : actorId,
          updatedBy: actorId
        },
        { merge: true }
      );
    });

    return {
      ok: true,
      message: "La carga fue actualizada.",
      data: {
        operacionId: safeOperacionId
      }
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "No fue posible actualizar la carga."
    };
  }
}

export async function eliminarOperacionEgreso(
  operacionId: string,
  actorUid?: string
): Promise<ActionState<OperacionMutationData>> {
  const safeOperacionId = compactarEspacios(operacionId);

  if (!safeOperacionId) {
    return {
      ok: false,
      message: "La carga indicada no es valida."
    };
  }

  const config = OPERACION_CONFIG.egreso;
  const db = getAdminDb();
  const actorId = actorUid?.trim() || DEFAULT_FIRESTORE_ACTOR;
  const now = Timestamp.now();
  let storagePath: string | null = null;
  const operacionRef = db.collection(config.collection).doc(safeOperacionId);

  try {
    await db.runTransaction(async (transaction) => {
      const operacionSnap = await transaction.get(operacionRef);

      if (!operacionSnap.exists) {
        throw new Error("La carga que intenta eliminar ya no existe.");
      }

      const existingData = operacionSnap.data() ?? {};
      storagePath = getCartaPorteStoragePath(existingData);
      const storedDetalleEnvases = getStoredDetalleEnvases(existingData);
      const movementLookupIds = [
        ...new Set([
          ...storedDetalleEnvases.map((detail) => detail.envaseTipoId),
          ...(typeof existingData.envaseTipoId === "string"
            ? [compactarEspacios(existingData.envaseTipoId)]
            : []),
        ]),
      ];
      const existingMovementDocs = await getOperacionMovementDocs(
        transaction,
        db,
        safeOperacionId,
        movementLookupIds,
      );
      const reverseStockUpdates = new Map<
        string,
        {
          envaseRef: FirebaseFirestore.DocumentReference;
          stockDelta: number;
          ingresosDelta: number;
          egresosDelta: number;
        }
      >();

      for (const movimientoDocumento of existingMovementDocs) {
        const movimientoData = movimientoDocumento.data();
        const envaseRef = movimientoDocumento.ref.parent.parent;

        if (!envaseRef) {
          transaction.delete(movimientoDocumento.ref);
          continue;
        }

        const stockBase =
          getNumericValue(movimientoData, ["deltaEnvases", "cantidadEnvases"]) || 0;
        const cantidadBase =
          getNumericValue(movimientoData, ["cantidadEnvases", "deltaEnvases"]) || 0;
        const tipoMovimiento =
          typeof movimientoData.tipoMovimiento === "string"
            ? movimientoData.tipoMovimiento
            : "egreso";
        const currentUpdate = reverseStockUpdates.get(envaseRef.path) ?? {
          envaseRef,
          stockDelta: 0,
          ingresosDelta: 0,
          egresosDelta: 0
        };

        if (tipoMovimiento === "ingreso") {
          currentUpdate.stockDelta -= Math.abs(stockBase);
          currentUpdate.ingresosDelta -= Math.abs(cantidadBase);
        } else if (tipoMovimiento === "egreso") {
          currentUpdate.stockDelta += Math.abs(stockBase);
          currentUpdate.egresosDelta -= Math.abs(cantidadBase);
        }

        reverseStockUpdates.set(envaseRef.path, currentUpdate);
        transaction.delete(movimientoDocumento.ref);
      }

      for (const update of reverseStockUpdates.values()) {
        applyLegacyIngresoStockDelta(transaction, update.envaseRef, update, actorId, now);
      }

      const previousNumeroCartaPorte =
        typeof existingData.numeroCartaPorte === "string"
          ? compactarEspacios(existingData.numeroCartaPorte)
          : "";

      if (previousNumeroCartaPorte) {
        transaction.delete(
          db
            .collection(COLLECTIONS.operacionesKeys)
            .doc(`${config.keyPrefix}__${normalizarTextoParaIndice(previousNumeroCartaPorte)}`)
        );
      }

      transaction.delete(operacionRef);
    });

    if (storagePath) {
      await eliminarCartaDePorte(storagePath).catch(() => undefined);
    }

    return {
      ok: true,
      message: "La carga fue eliminada.",
      data: {
        operacionId: safeOperacionId
      }
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "No fue posible eliminar la carga."
    };
  }
}

export async function crearOperacionEgreso(
  rawInput: unknown,
  actorUid?: string
): Promise<ActionState<CrearOperacionData>> {
  const parsedInput = operacionEgresoPersistenciaSchema.safeParse(rawInput);

  if (!parsedInput.success) {
    return {
      ok: false,
      message: "La carga no paso la validacion de dominio.",
      fieldErrors: parsedInput.error.flatten().fieldErrors
    };
  }

  return crearOperacionTransaccional(parsedInput.data, actorUid);
}

export async function crearEnvase(
  rawInput: unknown,
  actorUid?: string
): Promise<ActionState<CrearEnvaseData>> {
  const parsedInput = envaseFormSchema.safeParse(rawInput);

  if (!parsedInput.success) {
    return {
      ok: false,
      message: "El envase no paso la validacion del formulario.",
      fieldErrors: parsedInput.error.flatten().fieldErrors
    };
  }

  const input: EnvaseFormInput = parsedInput.data;
  const db = getAdminDb();
  const now = Timestamp.now();
  const actorId = actorUid?.trim() || DEFAULT_FIRESTORE_ACTOR;
  const codigo = compactarEspacios(input.codigo).toUpperCase();
  const nombre = compactarEspacios(input.nombre);
  const envaseId = sanearSegmentoArchivo(codigo, "envase");
  const envaseRef = db.collection(COLLECTIONS.envases).doc(envaseId);

  try {
    await db.runTransaction(async (transaction) => {
      const envaseSnap = await transaction.get(envaseRef);

      if (envaseSnap.exists) {
        throw new Error(`Ya existe un envase con codigo ${codigo}.`);
      }

      transaction.create(envaseRef, {
        codigo,
        nombre,
        descripcion: input.descripcion ? compactarEspacios(input.descripcion) : "",
        controlaStock: input.controlaStock,
        activo: true,
        orden: input.orden,
        stockActual: input.stockActual,
        ingresosAcumulados: Math.max(input.stockActual, 0),
        egresosAcumulados: 0,
        ajustesAcumulados: 0,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
        updatedBy: actorId,
        version: 0
      });
    });

    return {
      ok: true,
      message: "El envase fue creado en la coleccion envases.",
      data: {
        envaseId
      }
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "No fue posible crear el envase."
    };
  }
}

export async function getEnvasesPageData() {
  try {
    return {
      firestoreDisponible: true,
      envases: await getEnvasesOperativos()
    };
  } catch {
    return {
      firestoreDisponible: false,
      envases: []
    };
  }
}

// Compatibilidad con la ruta anterior de cargas.
export type CrearOperacionCargaData = CrearOperacionData;

export async function crearOperacionCarga(
  rawInput: unknown
): Promise<ActionState<CrearOperacionCargaData>> {
  return crearOperacionEgreso(rawInput);
}
