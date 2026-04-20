import "server-only";

import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  getEnvasesOperativos,
  type EnvaseOption,
} from "@/lib/services/operaciones";
import { getPlantStockAvailabilityMap } from "@/lib/services/envases-ledger";
import {
  compactarEspacios,
  construirClavesFecha,
  normalizarTextoParaIndice,
  timestampLikeToDate,
} from "@/lib/utils";
import {
  COLLECTIONS,
  envaseSchema,
  envaseTipoSchema,
  procesoRegistroFormSchema,
  procesoRegistroSchema,
  type ActionState,
  type ProcesoRegistro,
  type ProcesoRegistroFormInput,
  type ProcesoSalida,
  type ProcesoSalidaFormInput,
  type TipoOrdenProceso,
  type TipoProcesoRegistro,
} from "@/types/schema";

const DEFAULT_FIRESTORE_ACTOR =
  process.env.FIRESTORE_DEFAULT_ACTOR?.trim() || "audit-alta-system";

type EnvaseResolved = {
  envaseTipoId: string;
  codigo: string;
  nombre: string;
  activo: boolean;
  inventoryId: string;
  envaseEstado: string;
  envaseKilos: number;
  envaseVisibleId: string;
};

type RestoredPlantStockEntry = {
  inventoryId: string;
  visibleId: string;
  envaseTipoId: string;
  envaseTipoCodigo: string;
  envaseTipoNombre: string;
  envaseEstado: string;
  kilos: number;
  cantidad: number;
};

export type RegistroProceso = Pick<
  ProcesoRegistro,
  | "numeroProceso"
  | "proceso"
  | "cliente"
  | "producto"
  | "proveedor"
  | "procedencia"
  | "tipoOrden"
  | "tipoProceso"
  | "kilos"
  | "kilosTotal"
  | "kilosProcesado"
  | "kilosNoRecuperable"
  | "kilosAlmacenados"
  | "kilosReprocesados"
  | "envaseTipoId"
  | "envaseTipoCodigo"
  | "envaseTipoNombre"
  | "envaseEstado"
  | "envaseKilos"
  | "envaseCantidad"
  | "salidas"
  | "observaciones"
> & {
  id: string;
  fechaProceso: Date | null;
  createdAt: Date | null;
};

export type ProcesoStoredItem = {
  id: string;
  procesoId: string;
  salidaId: string;
  fechaProceso: Date | null;
  cliente: string;
  proceso: string;
  producto: string;
  procedencia: string;
  grado: ProcesoSalida["grado"];
  detalle: string;
  kilos: number;
  kilosDisponibles: number;
  envaseTipoId: string;
  envaseTipoNombre: string;
  envaseEstado: string;
  envaseVisibleId: string;
  inventoryId: string;
  pesoEnvaseKg: number;
  cantidadDisponible: number;
  tipoOrden: TipoOrdenProceso;
};

export type ModuloProcesosData = {
  firestoreDisponible: boolean;
  envases: EnvaseOption[];
  registros: RegistroProceso[];
};

export type CrearProcesoData = {
  procesoId: string;
};

export type ProcesoMutationData = {
  procesoId: string;
};

function buildSalidaId(index: number) {
  const randomSeed = Math.random().toString(36).slice(2, 8);
  return `salida-${Date.now()}-${index + 1}-${randomSeed}`;
}

function mapTipoProceso(
  tipoOrden: TipoOrdenProceso,
  salidas: ProcesoSalida[],
): TipoProcesoRegistro {
  const kilosProcesados = salidas
    .filter((salida) => salida.grado !== "no_recuperable")
    .reduce((total, salida) => total + Number(salida.kilos ?? 0), 0);

  if (kilosProcesados <= 0) {
    return "descarte";
  }

  return tipoOrden === "reprocesado" ? "egreso" : "envasado";
}

function computeAggregates(
  tipoOrden: TipoOrdenProceso,
  salidas: ProcesoSalida[],
) {
  const kilosTotal = salidas.reduce(
    (total, salida) => total + Number(salida.kilos ?? 0),
    0,
  );
  const kilosProcesado = salidas
    .filter(
      (salida) =>
        salida.grado === "exportacion" || salida.grado === "recupero",
    )
    .reduce((total, salida) => total + Number(salida.kilos ?? 0), 0);
  const kilosNoRecuperable = salidas
    .filter((salida) => salida.grado === "no_recuperable")
    .reduce((total, salida) => total + Number(salida.kilos ?? 0), 0);
  const kilosAlmacenados = salidas
    .filter(
      (salida) =>
        salida.estadoAlmacenamiento === "activo" &&
        (salida.grado === "exportacion" ||
          salida.grado === "recupero" ||
          salida.grado === "no_recuperable") &&
        compactarEspacios(salida.envaseTipoId).length > 0,
    )
    .reduce((total, salida) => total + Number(salida.kilos ?? 0), 0);
  const kilosReprocesados =
    tipoOrden === "reprocesado" ? kilosProcesado : 0;

  return {
    kilosAlmacenados,
    kilosNoRecuperable,
    kilosProcesado,
    kilosReprocesados,
    kilosTotal,
    tipoProceso: mapTipoProceso(tipoOrden, salidas),
  };
}

function getEnvaseParaProceso(
  envaseId: string,
  envaseSnap: FirebaseFirestore.DocumentSnapshot,
  legacyTipoSnap: FirebaseFirestore.DocumentSnapshot,
): EnvaseResolved | null {
  if (envaseSnap.exists) {
    const parsedEnvase = envaseSchema.safeParse(envaseSnap.data());

    if (parsedEnvase.success) {
      return {
        envaseTipoId: envaseId,
        codigo: parsedEnvase.data.codigo,
        nombre: parsedEnvase.data.nombre,
        activo: parsedEnvase.data.activo,
        inventoryId: "",
        envaseEstado: "",
        envaseKilos: 0,
        envaseVisibleId: "",
      };
    }
  }

  if (legacyTipoSnap.exists) {
    const parsedTipo = envaseTipoSchema.safeParse(legacyTipoSnap.data());

    if (parsedTipo.success) {
      return {
        envaseTipoId: envaseId,
        codigo: parsedTipo.data.codigo,
        nombre: parsedTipo.data.nombre,
        activo: parsedTipo.data.activo,
        inventoryId: "",
        envaseEstado: "",
        envaseKilos: 0,
        envaseVisibleId: "",
      };
    }
  }

  return null;
}

function buildProcesoVisibleId(nombre: string, estado: string, kilos: number) {
  return `${nombre} | ${estado} | ${kilos} kg`;
}

function buildRestoredPlantAvailability(previousSalidas: ProcesoSalida[]) {
  const restoredAvailability = new Map<string, RestoredPlantStockEntry>();

  for (const salida of previousSalidas) {
    const inventoryId = compactarEspacios(salida.inventoryId ?? "");
    const cantidad = Number(salida.cantidadEnvases ?? 0);

    if (!inventoryId || cantidad <= 0) {
      continue;
    }

    const existingEntry = restoredAvailability.get(inventoryId);

    if (existingEntry) {
      existingEntry.cantidad += cantidad;
      continue;
    }

    const envaseTipoId = compactarEspacios(salida.envaseTipoId ?? "");
    const envaseTipoNombre =
      compactarEspacios(salida.envaseTipoNombre ?? "") ||
      envaseTipoId ||
      "Sin envase";
    const envaseEstado = compactarEspacios(salida.envaseEstado ?? "");
    const kilos = Number(salida.envaseKilos ?? 0);

    restoredAvailability.set(inventoryId, {
      inventoryId,
      visibleId:
        compactarEspacios(salida.envaseVisibleId ?? "") ||
        buildProcesoVisibleId(envaseTipoNombre, envaseEstado, kilos),
      envaseTipoId,
      envaseTipoCodigo: compactarEspacios(salida.envaseTipoCodigo ?? ""),
      envaseTipoNombre,
      envaseEstado,
      kilos,
      cantidad,
    });
  }

  return restoredAvailability;
}

async function resolveEnvaseSelections(
  transaction: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  salidas: ProcesoSalidaFormInput[],
  restoredAvailabilityByInventoryId: Map<string, RestoredPlantStockEntry> = new Map(),
) {
  const availabilityMap = await getPlantStockAvailabilityMap();
  const fallbackEnvaseIds = [
    ...new Set(
      salidas
        .map((salida) => compactarEspacios(salida.envaseTipoId ?? ""))
        .filter(Boolean),
    ),
  ];
  const fallbackEnvases = new Map<string, EnvaseResolved>();

  await Promise.all(
    fallbackEnvaseIds.map(async (envaseId) => {
      const [envaseSnap, legacyTipoSnap] = await Promise.all([
        transaction.get(db.collection(COLLECTIONS.envases).doc(envaseId)),
        transaction.get(db.collection(COLLECTIONS.envaseTipos).doc(envaseId)),
      ]);
      const envase = getEnvaseParaProceso(
        envaseId,
        envaseSnap,
        legacyTipoSnap,
      );

      if (envase) {
        fallbackEnvases.set(envaseId, envase);
      }
    }),
  );

  return salidas.map((salida) => {
    const inventoryId = compactarEspacios(salida.inventoryId ?? "");
    const directEnvaseId = compactarEspacios(salida.envaseTipoId ?? "");

    if (!inventoryId && !directEnvaseId) {
      return null;
    }

    if (inventoryId) {
      const stockEntry = availabilityMap.get(inventoryId);
      const restoredEntry = restoredAvailabilityByInventoryId.get(inventoryId);
      const resolvedEntry = stockEntry
        ? {
            ...stockEntry,
            cantidad: stockEntry.cantidad + Number(restoredEntry?.cantidad ?? 0),
          }
        : restoredEntry;

      if (!resolvedEntry) {
        throw new Error("El envase seleccionado ya no existe en el stock general.");
      }

      return {
        envaseTipoId: resolvedEntry.envaseTipoId,
        codigo: resolvedEntry.envaseTipoCodigo,
        nombre: resolvedEntry.envaseTipoNombre,
        activo: true,
        inventoryId: resolvedEntry.inventoryId,
        envaseEstado: resolvedEntry.envaseEstado,
        envaseKilos: resolvedEntry.kilos,
        envaseVisibleId: resolvedEntry.visibleId,
      } satisfies EnvaseResolved;
    }

    const fallbackEnvase = fallbackEnvases.get(directEnvaseId);

    if (!fallbackEnvase) {
      throw new Error("El envase seleccionado no existe.");
    }

    if (fallbackEnvase.activo === false) {
      throw new Error("El envase seleccionado esta inactivo.");
    }

    return {
      ...fallbackEnvase,
      inventoryId: "",
      envaseEstado: compactarEspacios(salida.envaseEstado ?? ""),
      envaseKilos: Number(salida.envaseKilos ?? 0),
      envaseVisibleId: compactarEspacios(salida.envaseVisibleId ?? ""),
    } satisfies EnvaseResolved;
  });
}

function normalizeProcesoSalidas(
  input: ProcesoRegistroFormInput,
  resolvedEnvases: Array<EnvaseResolved | null>,
  previousSalidas: ProcesoSalida[] = [],
) {
  return input.salidas.map((salida, index) => {
    const resolvedEnvase = resolvedEnvases[index] ?? null;
    const envaseTipoId =
      compactarEspacios(resolvedEnvase?.envaseTipoId ?? salida.envaseTipoId ?? "");
    const previousSalida =
      salida.id && salida.id.trim().length > 0
        ? previousSalidas.find((item) => item.id === salida.id)
        : null;

    return {
      id: compactarEspacios(salida.id ?? "") || previousSalida?.id || buildSalidaId(index),
      grado: salida.grado,
      detalle: compactarEspacios(salida.detalle),
      kilos: Number(salida.kilos ?? 0),
      cantidadEnvases: Number(salida.cantidadEnvases ?? previousSalida?.cantidadEnvases ?? 0),
      envaseTipoId,
      inventoryId:
        compactarEspacios(resolvedEnvase?.inventoryId ?? salida.inventoryId ?? "") ||
        previousSalida?.inventoryId ||
        "",
      envaseEstado:
        compactarEspacios(resolvedEnvase?.envaseEstado ?? salida.envaseEstado ?? "") ||
        previousSalida?.envaseEstado ||
        "",
      envaseKilos: Number(
        resolvedEnvase?.envaseKilos ?? salida.envaseKilos ?? previousSalida?.envaseKilos ?? 0
      ),
      envaseVisibleId:
        compactarEspacios(resolvedEnvase?.envaseVisibleId ?? salida.envaseVisibleId ?? "") ||
        previousSalida?.envaseVisibleId ||
        "",
      envaseTipoCodigo: resolvedEnvase?.codigo ?? previousSalida?.envaseTipoCodigo ?? "",
      envaseTipoNombre: resolvedEnvase?.nombre ?? previousSalida?.envaseTipoNombre ?? "",
      estadoAlmacenamiento:
        previousSalida?.estadoAlmacenamiento ?? "activo",
      reprocessedAt: previousSalida?.reprocessedAt,
    } satisfies ProcesoSalida;
  });
}

function sanitizeProcesoSalidasForFirestore(salidas: ProcesoSalida[]) {
  return salidas.map((salida) => {
    const sanitizedSalida: Record<string, unknown> = {
      id: salida.id,
      grado: salida.grado,
      detalle: salida.detalle,
      kilos: Number(salida.kilos ?? 0),
      cantidadEnvases: Number(salida.cantidadEnvases ?? 0),
      envaseTipoId: salida.envaseTipoId ?? "",
      inventoryId: salida.inventoryId ?? "",
      envaseEstado: salida.envaseEstado ?? "",
      envaseKilos: Number(salida.envaseKilos ?? 0),
      envaseVisibleId: salida.envaseVisibleId ?? "",
      envaseTipoCodigo: salida.envaseTipoCodigo ?? "",
      envaseTipoNombre: salida.envaseTipoNombre ?? "",
      estadoAlmacenamiento: salida.estadoAlmacenamiento ?? "activo",
    };

    if (salida.reprocessedAt) {
      sanitizedSalida.reprocessedAt = salida.reprocessedAt;
    }

    return sanitizedSalida;
  });
}

function buildPrimarySalida(salidas: ProcesoSalida[]) {
  return (
    salidas.find(
      (salida) =>
        salida.estadoAlmacenamiento === "activo" &&
        compactarEspacios(salida.envaseTipoId).length > 0,
    ) ??
    salidas.find((salida) => compactarEspacios(salida.envaseTipoId).length > 0) ??
    salidas[0] ??
    null
  );
}

function buildLegacySalidas(record: ProcesoRegistro) {
  if (record.salidas && record.salidas.length > 0) {
    return record.salidas;
  }

  if ((record.kilosTotal ?? record.kilos ?? 0) <= 0) {
    return [];
  }

  return [
    {
      id: `legacy-${record.numeroProceso || record.proceso || "salida-1"}`,
      grado: record.tipoProceso === "descarte" ? "no_recuperable" : "exportacion",
      detalle:
        record.tipoProceso === "descarte" ? "Rechazo" : "Procesado",
      kilos: record.kilosTotal || record.kilos || 0,
      cantidadEnvases:
        (record.envaseCantidad ?? 0) > 0
          ? Number(record.envaseCantidad ?? 0)
          : record.envaseTipoId
            ? 1
            : 0,
      envaseTipoId: record.envaseTipoId || "",
      inventoryId: "",
      envaseEstado: record.envaseEstado || "",
      envaseKilos: record.envaseKilos || 0,
      envaseVisibleId: "",
      envaseTipoCodigo: record.envaseTipoCodigo || "",
      envaseTipoNombre: record.envaseTipoNombre || "",
      estadoAlmacenamiento: "activo",
      reprocessedAt: undefined,
    } satisfies ProcesoSalida,
  ];
}

function parseProcesoSnapshot(
  id: string,
  data: FirebaseFirestore.DocumentData,
): RegistroProceso | null {
  const parsed = procesoRegistroSchema.safeParse(data);

  if (!parsed.success) {
    return null;
  }

  const tipoOrden = parsed.data.tipoOrden ?? "procesado";
  const salidas = buildLegacySalidas(parsed.data);
  const aggregates = computeAggregates(tipoOrden, salidas);
  const primarySalida = buildPrimarySalida(salidas);
  const procesoValue = compactarEspacios(
    parsed.data.proceso || parsed.data.numeroProceso || "Sin proceso",
  );
  const procedenciaValue = compactarEspacios(
    parsed.data.procedencia || parsed.data.proveedor || "",
  );

  return {
    id,
    numeroProceso:
      compactarEspacios(parsed.data.numeroProceso || procesoValue) || procesoValue,
    proceso: procesoValue,
    cliente: parsed.data.cliente,
    producto: compactarEspacios(parsed.data.producto || ""),
    proveedor: compactarEspacios(
      parsed.data.proveedor || parsed.data.procedencia || "",
    ),
    procedencia: procedenciaValue,
    tipoOrden,
    tipoProceso: parsed.data.tipoProceso || aggregates.tipoProceso,
    kilos: parsed.data.kilosTotal || parsed.data.kilos || aggregates.kilosTotal,
    kilosTotal: parsed.data.kilosTotal || aggregates.kilosTotal,
    kilosProcesado: parsed.data.kilosProcesado || aggregates.kilosProcesado,
    kilosNoRecuperable:
      parsed.data.kilosNoRecuperable || aggregates.kilosNoRecuperable,
    kilosAlmacenados:
      parsed.data.kilosAlmacenados || aggregates.kilosAlmacenados,
    kilosReprocesados:
      parsed.data.kilosReprocesados || aggregates.kilosReprocesados,
    envaseTipoId: primarySalida?.envaseTipoId || "",
    envaseTipoCodigo: primarySalida?.envaseTipoCodigo || "",
    envaseTipoNombre: primarySalida?.envaseTipoNombre || "",
    envaseEstado: primarySalida?.envaseEstado || parsed.data.envaseEstado || "",
    envaseKilos:
      Number(primarySalida?.envaseKilos ?? 0) > 0
        ? Number(primarySalida?.envaseKilos ?? 0)
        : primarySalida?.kilos || parsed.data.envaseKilos || 0,
    envaseCantidad: salidas
      .filter(
        (salida) =>
          salida.estadoAlmacenamiento === "activo" &&
          compactarEspacios(salida.envaseTipoId).length > 0,
      )
      .reduce((total, salida) => total + Number(salida.cantidadEnvases ?? 0), 0),
    salidas,
    observaciones: parsed.data.observaciones,
    fechaProceso: timestampLikeToDate(parsed.data.fechaProceso),
    createdAt: timestampLikeToDate(parsed.data.createdAt),
  };
}

function buildProcessPayload(params: {
  input: ProcesoRegistroFormInput;
  actorId: string;
  now: FirebaseFirestore.Timestamp;
  previousData?: FirebaseFirestore.DocumentData;
  salidas: ProcesoSalida[];
}) {
  const { input, actorId, now, previousData, salidas } = params;
  const fechaKeys = construirClavesFecha(input.fechaProceso);
  const fechaProceso = Timestamp.fromDate(
    new Date(`${input.fechaProceso}T00:00:00.000Z`),
  );
  const cliente = compactarEspacios(input.cliente);
  const proceso = compactarEspacios(input.proceso);
  const procedencia = compactarEspacios(input.procedencia ?? "");
  const producto = compactarEspacios(input.producto ?? "");
  const observaciones = input.observaciones
    ? compactarEspacios(input.observaciones)
    : null;
  const aggregates = computeAggregates(input.tipoOrden, salidas);
  const primarySalida = buildPrimarySalida(salidas);
  const persistedSalidas = sanitizeProcesoSalidasForFirestore(salidas);

  return {
    fechaProceso,
    ...fechaKeys,
    numeroProceso:
      compactarEspacios(
        typeof previousData?.numeroProceso === "string"
          ? previousData.numeroProceso
          : proceso,
      ) || proceso,
    numeroProcesoNormalizado: normalizarTextoParaIndice(proceso),
    cliente,
    clienteNormalizado: normalizarTextoParaIndice(cliente),
    proceso,
    procesoNormalizado: normalizarTextoParaIndice(proceso),
    producto,
    productoNormalizado: normalizarTextoParaIndice(producto),
    proveedor: procedencia,
    proveedorNormalizado: normalizarTextoParaIndice(procedencia),
    procedencia,
    procedenciaNormalizada: normalizarTextoParaIndice(procedencia),
    tipoOrden: input.tipoOrden,
    tipoProceso: aggregates.tipoProceso,
    tipoProcesoNormalizado: normalizarTextoParaIndice(aggregates.tipoProceso),
    kilos: aggregates.kilosTotal,
    kilosTotal: aggregates.kilosTotal,
    kilosProcesado: aggregates.kilosProcesado,
    kilosNoRecuperable: aggregates.kilosNoRecuperable,
    kilosAlmacenados: aggregates.kilosAlmacenados,
    kilosReprocesados: aggregates.kilosReprocesados,
    salidas: persistedSalidas,
    envaseTipoId: primarySalida?.envaseTipoId || "",
    envaseTipoCodigo: primarySalida?.envaseTipoCodigo || "",
    envaseTipoNombre: primarySalida?.envaseTipoNombre || "",
    envaseEstado: primarySalida?.envaseEstado || "",
    envaseKilos:
      Number(primarySalida?.envaseKilos ?? 0) > 0
        ? Number(primarySalida?.envaseKilos ?? 0)
        : primarySalida?.kilos || 0,
    envaseCantidad: salidas
      .filter(
        (salida) =>
          salida.estadoAlmacenamiento === "activo" &&
          compactarEspacios(salida.envaseTipoId).length > 0,
      )
      .reduce((total, salida) => total + Number(salida.cantidadEnvases ?? 0), 0),
    observaciones,
    createdAt:
      previousData?.createdAt instanceof Timestamp ? previousData.createdAt : now,
    updatedAt: now,
    createdBy:
      typeof previousData?.createdBy === "string"
        ? previousData.createdBy
        : actorId,
    updatedBy: actorId,
  };
}

export async function getProcesosModuleData(): Promise<ModuloProcesosData> {
  const emptyData: ModuloProcesosData = {
    firestoreDisponible: false,
    envases: [],
    registros: [],
  };

  try {
    const db = getAdminDb();
    const [envases, procesosSnap] = await Promise.all([
      getEnvasesOperativos(),
      db
        .collection(COLLECTIONS.procesos)
        .orderBy("fechaProceso", "desc")
        .limit(200)
        .get(),
    ]);
    const registros = procesosSnap.docs.flatMap((documento) => {
      const parsed = parseProcesoSnapshot(documento.id, documento.data());
      return parsed ? [parsed] : [];
    });

    return {
      firestoreDisponible: true,
      envases,
      registros,
    };
  } catch {
    return emptyData;
  }
}

export async function crearProceso(
  rawInput: unknown,
  actorUid?: string,
): Promise<ActionState<CrearProcesoData>> {
  const parsedInput = procesoRegistroFormSchema.safeParse(rawInput);

  if (!parsedInput.success) {
    return {
      ok: false,
      message: "El proceso no paso la validacion del formulario.",
      fieldErrors: parsedInput.error.flatten().fieldErrors,
    };
  }

  const input: ProcesoRegistroFormInput = parsedInput.data;
  const db = getAdminDb();
  const actorId = actorUid?.trim() || DEFAULT_FIRESTORE_ACTOR;
  const now = Timestamp.now();
  const procesoRef = db.collection(COLLECTIONS.procesos).doc();

  try {
    await db.runTransaction(async (transaction) => {
      const resolvedEnvases = await resolveEnvaseSelections(transaction, db, input.salidas);
      const salidas = normalizeProcesoSalidas(input, resolvedEnvases);
      const payload = buildProcessPayload({
        input,
        actorId,
        now,
        salidas,
      });

      transaction.create(procesoRef, payload);
    });

    return {
      ok: true,
      message: "El proceso fue registrado en Firestore.",
      data: {
        procesoId: procesoRef.id,
      },
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "No fue posible registrar el proceso.",
    };
  }
}

export async function actualizarProceso(
  procesoId: string,
  rawInput: unknown,
  actorUid?: string,
): Promise<ActionState<ProcesoMutationData>> {
  const parsedInput = procesoRegistroFormSchema.safeParse(rawInput);

  if (!parsedInput.success) {
    return {
      ok: false,
      message: "El proceso no paso la validacion del formulario.",
      fieldErrors: parsedInput.error.flatten().fieldErrors,
    };
  }

  const safeProcesoId = compactarEspacios(procesoId);

  if (!safeProcesoId) {
    return {
      ok: false,
      message: "El proceso indicado no es valido.",
    };
  }

  const db = getAdminDb();
  const actorId = actorUid?.trim() || DEFAULT_FIRESTORE_ACTOR;
  const now = Timestamp.now();
  const procesoRef = db.collection(COLLECTIONS.procesos).doc(safeProcesoId);

  try {
    await db.runTransaction(async (transaction) => {
      const procesoSnap = await transaction.get(procesoRef);

      if (!procesoSnap.exists) {
        throw new Error("El proceso que intenta editar ya no existe.");
      }

      const existingData = procesoSnap.data() ?? {};
      const existingRecord = procesoRegistroSchema.safeParse(existingData);
      const previousSalidas = existingRecord.success
        ? buildLegacySalidas(existingRecord.data)
        : [];
      const restoredAvailabilityByInventoryId =
        buildRestoredPlantAvailability(previousSalidas);
      const resolvedEnvases = await resolveEnvaseSelections(
        transaction,
        db,
        parsedInput.data.salidas,
        restoredAvailabilityByInventoryId,
      );
      const salidas = normalizeProcesoSalidas(
        parsedInput.data,
        resolvedEnvases,
        previousSalidas,
      );
      const payload = buildProcessPayload({
        input: parsedInput.data,
        actorId,
        now,
        previousData: existingData,
        salidas,
      });

      transaction.set(procesoRef, payload, { merge: true });
    });

    return {
      ok: true,
      message: "El proceso fue actualizado.",
      data: {
        procesoId: safeProcesoId,
      },
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "No fue posible actualizar el proceso.",
    };
  }
}

export async function eliminarProceso(
  procesoId: string,
): Promise<ActionState<ProcesoMutationData>> {
  const safeProcesoId = compactarEspacios(procesoId);

  if (!safeProcesoId) {
    return {
      ok: false,
      message: "El proceso indicado no es valido.",
    };
  }

  const db = getAdminDb();
  const procesoRef = db.collection(COLLECTIONS.procesos).doc(safeProcesoId);

  try {
    await procesoRef.delete();

    return {
      ok: true,
      message: "El proceso fue eliminado.",
      data: {
        procesoId: safeProcesoId,
      },
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "No fue posible eliminar el proceso.",
    };
  }
}

export async function reprocesarSalidaProceso(
  procesoId: string,
  salidaId: string,
  actorUid?: string,
): Promise<ActionState<ProcesoMutationData>> {
  const safeProcesoId = compactarEspacios(procesoId);
  const safeSalidaId = compactarEspacios(salidaId);

  if (!safeProcesoId || !safeSalidaId) {
    return {
      ok: false,
      message: "La salida seleccionada no es valida.",
    };
  }

  const db = getAdminDb();
  const actorId = actorUid?.trim() || DEFAULT_FIRESTORE_ACTOR;
  const now = Timestamp.now();
  const procesoRef = db.collection(COLLECTIONS.procesos).doc(safeProcesoId);

  try {
    await db.runTransaction(async (transaction) => {
      const procesoSnap = await transaction.get(procesoRef);

      if (!procesoSnap.exists) {
        throw new Error("El proceso seleccionado ya no existe.");
      }

      const parsed = procesoRegistroSchema.safeParse(procesoSnap.data() ?? {});

      if (!parsed.success) {
        throw new Error("El proceso seleccionado tiene un formato invalido.");
      }

      const salidas = buildLegacySalidas(parsed.data);
      const salida = salidas.find((item) => item.id === safeSalidaId);

      if (!salida) {
        throw new Error("La salida seleccionada ya no existe.");
      }

      if (salida.estadoAlmacenamiento !== "activo") {
        throw new Error("La salida seleccionada ya fue reprocesada.");
      }

      const nextSalidas = salidas.map((item) =>
        item.id === safeSalidaId
          ? {
              ...item,
              estadoAlmacenamiento: "reprocesado" as const,
              reprocessedAt: now.toDate(),
            }
          : item,
      );
      const payload = buildProcessPayload({
        input: {
          fechaProceso:
            typeof parsed.data.fechaKey === "string" ? parsed.data.fechaKey : "",
          cliente: parsed.data.cliente,
          proceso: parsed.data.proceso || parsed.data.numeroProceso || "",
          procedencia: parsed.data.procedencia || parsed.data.proveedor || "",
          producto: parsed.data.producto || "",
          tipoOrden: parsed.data.tipoOrden || "procesado",
          salidas: nextSalidas.map((item) => ({
            id: item.id,
            grado: item.grado,
            detalle: item.detalle,
            kilos: item.kilos,
            cantidadEnvases: item.cantidadEnvases ?? 0,
            envaseTipoId: item.envaseTipoId || "",
            inventoryId: item.inventoryId || "",
            envaseEstado: item.envaseEstado || "",
            envaseKilos: item.envaseKilos ?? 0,
            envaseVisibleId: item.envaseVisibleId || "",
          })),
          observaciones: parsed.data.observaciones ?? "",
        },
        actorId,
        now,
        previousData: procesoSnap.data() ?? {},
        salidas: nextSalidas,
      });

      transaction.set(procesoRef, payload, { merge: true });
    });

    return {
      ok: true,
      message: "La mercaderia almacenada fue marcada como reprocesada.",
      data: {
        procesoId: safeProcesoId,
      },
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "No fue posible reprocesar la salida.",
    };
  }
}

export async function eliminarSalidaProceso(
  procesoId: string,
  salidaId: string,
  actorUid?: string,
): Promise<ActionState<ProcesoMutationData>> {
  const safeProcesoId = compactarEspacios(procesoId);
  const safeSalidaId = compactarEspacios(salidaId);

  if (!safeProcesoId || !safeSalidaId) {
    return {
      ok: false,
      message: "La salida seleccionada no es valida.",
    };
  }

  const db = getAdminDb();
  const actorId = actorUid?.trim() || DEFAULT_FIRESTORE_ACTOR;
  const now = Timestamp.now();
  const procesoRef = db.collection(COLLECTIONS.procesos).doc(safeProcesoId);

  try {
    await db.runTransaction(async (transaction) => {
      const procesoSnap = await transaction.get(procesoRef);

      if (!procesoSnap.exists) {
        throw new Error("El proceso seleccionado ya no existe.");
      }

      const parsed = procesoRegistroSchema.safeParse(procesoSnap.data() ?? {});

      if (!parsed.success) {
        throw new Error("El proceso seleccionado tiene un formato invalido.");
      }

      const salidas = buildLegacySalidas(parsed.data);
      const nextSalidas = salidas.filter((item) => item.id !== safeSalidaId);

      if (nextSalidas.length === salidas.length) {
        throw new Error("La salida seleccionada ya no existe.");
      }

      if (nextSalidas.length === 0) {
        transaction.delete(procesoRef);
        return;
      }

      const payload = buildProcessPayload({
        input: {
          fechaProceso:
            typeof parsed.data.fechaKey === "string" ? parsed.data.fechaKey : "",
          cliente: parsed.data.cliente,
          proceso: parsed.data.proceso || parsed.data.numeroProceso || "",
          procedencia: parsed.data.procedencia || parsed.data.proveedor || "",
          producto: parsed.data.producto || "",
          tipoOrden: parsed.data.tipoOrden || "procesado",
          salidas: nextSalidas.map((item) => ({
            id: item.id,
            grado: item.grado,
            detalle: item.detalle,
            kilos: item.kilos,
            cantidadEnvases: item.cantidadEnvases ?? 0,
            envaseTipoId: item.envaseTipoId || "",
            inventoryId: item.inventoryId || "",
            envaseEstado: item.envaseEstado || "",
            envaseKilos: item.envaseKilos ?? 0,
            envaseVisibleId: item.envaseVisibleId || "",
          })),
          observaciones: parsed.data.observaciones ?? "",
        },
        actorId,
        now,
        previousData: procesoSnap.data() ?? {},
        salidas: nextSalidas,
      });

      transaction.set(procesoRef, payload, { merge: true });
    });

    return {
      ok: true,
      message: "La salida fue eliminada del proceso.",
      data: {
        procesoId: safeProcesoId,
      },
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "No fue posible eliminar la salida.",
    };
  }
}
