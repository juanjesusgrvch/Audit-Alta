import { z } from "zod";

const MAX_PDF_BYTES = 10 * 1024 * 1024;

export const fechaIsoSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener formato YYYY-MM-DD.");

export const firestoreTimestampLikeSchema = z.union([
  z.date(),
  z
    .object({
      seconds: z.number(),
      nanoseconds: z.number(),
    })
    .passthrough(),
  z
    .object({
      _seconds: z.number(),
      _nanoseconds: z.number(),
    })
    .passthrough(),
]);

const textoNormalizadoSchema = z.string().trim().min(1).max(160);
const observacionesSchema = z
  .string()
  .trim()
  .max(1000)
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

export const COLLECTIONS = {
  descargas: "descargas",
  cargas: "cargas",
  envases: "envases",
  envaseLotesOcultos: "envase_lotes_ocultos",
  procesos: "procesos",
  campanias: "campanias",
  defectos: "defectos",
  muestras: "muestras",
  usuarios: "usuarios",
  operacionesKeys: "operaciones_keys",
  dashboardResumenDiario: "dashboard_resumen_diario",
  // Colecciones heredadas: se conservan para migrar datos sin romper lo existente.
  operaciones: "operaciones",
  envaseTipos: "envase_tipos",
  envaseMovimientos: "envase_movimientos",
  envaseStock: "envase_stock",
} as const;

export const tipoModuloOperacionSchema = z.enum(["ingreso", "egreso"]);
export const tipoOperacionSchema = z.enum(["descarga", "carga"]);
export const tipoProcesoRegistroSchema = z.enum([
  "ingreso",
  "envasado",
  "egreso",
  "descarte",
]);
export const tipoOrdenProcesoSchema = z.enum(["procesado", "reprocesado"]);
export const gradoSalidaProcesoSchema = z.enum([
  "exportacion",
  "recupero",
  "no_recuperable",
]);
export const estadoAlmacenamientoProcesoSchema = z.enum([
  "activo",
  "reprocesado",
]);
export const tipoMovimientoEnvaseSchema = z.enum([
  "ingreso",
  "egreso",
  "ajuste_manual",
]);
export const tipoRegistroHistorialEnvaseSchema = z.enum([
  "ingreso",
  "envasado",
  "baja",
  "retiro",
]);
export const origenHistorialEnvaseSchema = z.enum([
  "descarga",
  "proceso",
  "manual_ingreso",
  "manual_baja",
  "manual_retiro",
]);

export const origenMovimientoEnvaseSchema = z.enum([
  "operacion_ingreso",
  "operacion_egreso",
  "operacion_descarga",
  "operacion_carga",
  "ajuste_manual",
]);
export const modoEnvasesOperacionSchema = z.enum([
  "granel",
  "manual",
  "envasados",
]);

export const packagingMovementTypeSchema = z.enum(["alta", "baja"]);
export const packagingTypeSchema = z.enum([
  "GRANEL",
  "BOLSA",
  "BOLSON",
  "OTRO",
]);
export const packagingConditionSchema = z.enum(["NUEVO", "USADO", "VIEJO"]);

const firestoreAuditFieldsShape = {
  createdAtMs: z.number().int().nonnegative().optional(),
  updatedAtMs: z.number().int().nonnegative().optional(),
  createdAt: firestoreTimestampLikeSchema.optional(),
  updatedAt: firestoreTimestampLikeSchema.optional(),
  createdBy: z.string().trim().min(1).max(160).optional(),
  updatedBy: z.string().trim().min(1).max(160).optional(),
} satisfies z.ZodRawShape;

export const packagingMovementSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    movementType: packagingMovementTypeSchema,
    packagingType: packagingTypeSchema,
    packagingCondition: packagingConditionSchema,
  })
  .passthrough();

const legacyDateValueSchema = z.union([
  fechaIsoSchema,
  firestoreTimestampLikeSchema,
]);

export const packagingMovementLegacySchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    movementType: z.string().trim().min(1).max(80),
    packagingType: z.string().trim().min(1).max(160),
    packagingCondition: z.string().trim().max(80).default(""),
  })
  .passthrough();

export const descargaLegacySchema = z
  .object({
    id: z.string().trim().min(1),
    entryDate: legacyDateValueSchema,
    truckPlate: z.string().trim().max(32).optional().default(""),
    client: z.string().trim().min(1).max(160),
    supplier: z.string().trim().min(1).max(160),
    product: z.string().trim().min(1).max(160),
    processCode: z.string().trim().min(1).max(160),
    grossKg: z.number().nonnegative().max(1_000_000_000),
    tareKg: z.number().nonnegative().max(1_000_000_000),
    netKg: z.number().nonnegative().max(1_000_000_000),
    withAnalysis: z.boolean(),
    analysisCode: z.string().trim().max(160).optional(),
    observations: z.string().trim().max(1000).optional().nullable(),
    packagingMovements: z.array(packagingMovementLegacySchema).default([]),
  })
  .extend(firestoreAuditFieldsShape)
  .passthrough();

export const defectoLegacySchema = z
  .object({
    id: z.string().trim().min(1),
    analysisDate: legacyDateValueSchema,
    client: z.string().trim().min(1).max(160),
    supplier: z.string().trim().min(1).max(160),
    product: z.string().trim().min(1).max(160),
    processCode: z.string().trim().min(1).max(160),
    sampleWeightGr: z.number().nonnegative().max(1_000_000),
    relatedAnalysis: z.string().trim().min(1).max(160).optional(),
    outputStage: z.string().trim().min(1).max(160),
    gramajeHundredths: z.number().int().nonnegative().optional(),
    humidity: z.number().nonnegative().max(100).optional(),
    defects: z.array(z.unknown()).default([]),
    observations: z.string().trim().max(1000).optional().nullable(),
  })
  .extend(firestoreAuditFieldsShape)
  .passthrough();

export const muestraLegacySchema = z
  .object({
    id: z.string().trim().min(1),
    storedAt: legacyDateValueSchema,
    sampleCode: z.string().trim().min(1).max(160),
    client: z.string().trim().min(1).max(160),
    supplier: z.string().trim().min(1).max(160),
    product: z.string().trim().min(1).max(160),
    processCode: z.string().trim().min(1).max(160),
    relatedAnalysisId: z.string().trim().min(1).max(160).optional(),
    warehouseZone: z.string().trim().min(1).max(160),
    shelf: z.string().trim().min(1).max(160),
    gramajeHundredths: z.number().int().nonnegative().optional(),
    quantityKg: z.number().nonnegative().max(1_000_000_000),
    retentionUntil: legacyDateValueSchema.optional(),
    status: z.string().trim().min(1).max(80),
    releasedAt: legacyDateValueSchema.optional(),
    notes: z.string().trim().max(1000).optional().nullable(),
  })
  .extend(firestoreAuditFieldsShape)
  .passthrough();

export const usuarioLegacySchema = z
  .object({
    uid: z.string().trim().min(1),
    email: z.string().trim().email(),
    displayName: z.string().trim().min(1).max(160).optional(),
    photoURL: z.string().trim().url().optional().nullable(),
    lastSeenAt: firestoreTimestampLikeSchema.optional(),
  })
  .passthrough();

export const cartaPorteArchivoSchema = z.object({
  storagePath: z.string().trim().min(1).max(512),
  downloadUrl: z.string().url(),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.literal("application/pdf"),
  sizeBytes: z.number().int().positive().max(MAX_PDF_BYTES),
});

export const envaseTipoSchema = z.object({
  codigo: z.string().trim().min(2).max(32),
  nombre: z.string().trim().min(2).max(120),
  descripcion: z.string().trim().max(240).optional(),
  controlaStock: z.boolean().default(true),
  activo: z.boolean().default(true),
  orden: z.number().int().nonnegative().default(0),
  createdAt: firestoreTimestampLikeSchema.optional(),
  updatedAt: firestoreTimestampLikeSchema.optional(),
});

export const envaseStockSchema = z.object({
  envaseTipoId: z.string().trim().min(1),
  envaseTipoCodigo: z.string().trim().min(2).max(32),
  envaseTipoNombre: z.string().trim().min(2).max(120),
  stockActual: z.number().int(),
  ingresosAcumulados: z.number().int().nonnegative().default(0),
  egresosAcumulados: z.number().int().nonnegative().default(0),
  ajustesAcumulados: z.number().int().default(0),
  updatedAt: firestoreTimestampLikeSchema.optional(),
  lastMovimientoId: z.string().trim().min(1).optional(),
  version: z.number().int().nonnegative().default(0),
});

export const envaseSchema = envaseTipoSchema.extend({
  stockActual: z.number().int().default(0),
  ingresosAcumulados: z.number().int().nonnegative().default(0),
  egresosAcumulados: z.number().int().nonnegative().default(0),
  ajustesAcumulados: z.number().int().default(0),
  lastMovimientoId: z.string().trim().min(1).optional(),
  version: z.number().int().nonnegative().default(0),
});

export const envaseFormSchema = z.object({
  codigo: z.string().trim().min(2).max(32),
  nombre: z.string().trim().min(2).max(120),
  descripcion: observacionesSchema,
  controlaStock: z.coerce.boolean().default(true),
  stockActual: z.coerce.number().int().min(-1_000_000).max(1_000_000),
  orden: z.coerce.number().int().nonnegative().default(0),
});

export const envaseIngresoManualFormSchema = z.object({
  fechaMovimiento: fechaIsoSchema,
  cliente: z.string().trim().min(2).max(160),
  envaseTipoId: z.string().trim().min(1, "Ingrese un tipo de envase.").max(160),
  envaseTipoNombre: z
    .string()
    .trim()
    .min(1, "Ingrese un tipo de envase.")
    .max(120),
  envaseEstado: z.string().trim().min(2).max(80),
  kilos: z.coerce.number().positive().max(1_000_000_000),
  cantidad: z.coerce.number().int().positive().max(1_000_000),
  transporte: z.string().trim().min(2).max(160),
  observaciones: observacionesSchema,
});

export const envaseBajaFormSchema = z.object({
  fechaMovimiento: fechaIsoSchema,
  cliente: z.string().trim().min(2).max(160),
  tipoSalida: z.enum(["baja", "retiro"]).default("baja"),
  kilos: z.coerce.number().positive().max(1_000_000_000),
  inventoryId: z.string().trim().min(3).max(200),
  sourceId: z.string().trim().max(200).optional().default(""),
  envaseTipoId: z.string().trim().min(1),
  envaseEstado: z.string().trim().min(2).max(80),
  cantidad: z.coerce.number().int().positive().max(1_000_000),
  causa: z.string().trim().min(2).max(160),
  observaciones: observacionesSchema,
});

export const envaseMovimientoManualIdSchema = z.object({
  movimientoId: z.string().trim().min(1).max(200),
});

export const envaseLoteOcultoSchema = z.object({
  inventoryId: z.string().trim().min(3).max(200),
  cliente: z.string().trim().min(2).max(160),
  hiddenAt: firestoreTimestampLikeSchema.optional(),
  hiddenBy: z.string().trim().min(1).max(160).optional(),
});

export const campaniaPeriodoSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    nombre: z.string().trim().min(1).max(120),
    fechaDesde: fechaIsoSchema,
    fechaHasta: fechaIsoSchema,
    predeterminada: z.coerce.boolean().optional().default(false),
  })
  .refine((value) => value.fechaHasta >= value.fechaDesde, {
    message: "La fecha de cierre no puede ser anterior al inicio.",
    path: ["fechaHasta"],
  });

export const campaniaPeriodosPayloadSchema = z.object({
  campanias: z.array(campaniaPeriodoSchema).max(24),
});

export const envaseMovimientoSchema = z.object({
  operacionId: z.string().trim().min(1).optional(),
  envaseTipoId: z.string().trim().min(1),
  envaseTipoCodigo: z.string().trim().min(2).max(32),
  envaseTipoNombre: z.string().trim().min(2).max(120),
  tipoMovimiento: tipoMovimientoEnvaseSchema,
  origen: origenMovimientoEnvaseSchema,
  cantidadEnvases: z.number().int().positive(),
  deltaEnvases: z.number().int(),
  fechaOperacion: firestoreTimestampLikeSchema,
  fechaKey: fechaIsoSchema,
  mesKey: z.string().regex(/^\d{4}-\d{2}$/),
  anioKey: z.string().regex(/^\d{4}$/),
  cliente: z.string().trim().min(2).max(160),
  clienteNormalizado: textoNormalizadoSchema,
  producto: z.string().trim().min(2).max(160),
  productoNormalizado: textoNormalizadoSchema,
  cartaPorteNumero: z.string().trim().min(1).max(64),
  observaciones: z.string().trim().max(1000).optional().nullable(),
  createdAt: firestoreTimestampLikeSchema.optional(),
});

export const envaseHistorialMovimientoSchema = z.object({
  tipoMovimiento: tipoRegistroHistorialEnvaseSchema,
  origen: origenHistorialEnvaseSchema,
  fechaMovimiento: firestoreTimestampLikeSchema,
  fechaKey: fechaIsoSchema,
  mesKey: z.string().regex(/^\d{4}-\d{2}$/),
  anioKey: z.string().regex(/^\d{4}$/),
  cliente: z.string().trim().min(2).max(160),
  clienteNormalizado: textoNormalizadoSchema,
  envaseTipoId: z.string().trim().min(1),
  envaseTipoCodigo: z.string().trim().min(2).max(32),
  envaseTipoNombre: z.string().trim().min(2).max(120),
  envaseEstado: z.string().trim().min(2).max(80),
  envaseEstadoNormalizado: textoNormalizadoSchema,
  kilos: z.number().positive().max(1_000_000_000),
  cantidad: z.number().int().positive().max(1_000_000),
  inventoryId: z.string().trim().min(3).max(200),
  transporte: z.string().trim().min(2).max(160).optional().nullable(),
  causa: z.string().trim().min(2).max(160).optional().nullable(),
  tipoProceso: z.string().trim().min(2).max(160).optional().nullable(),
  observaciones: z.string().trim().max(1000).optional().nullable(),
  sourceId: z.string().trim().min(1).optional(),
  createdAt: firestoreTimestampLikeSchema.optional(),
  updatedAt: firestoreTimestampLikeSchema.optional(),
});

export const operacionEnvaseDetalleFormSchema = z.object({
  inventoryId: z.string().trim().max(200).optional().default(""),
  envaseTipoId: z.string().trim().min(1),
  envaseTipoNombre: z.string().trim().max(120).optional().default(""),
  envaseEstado: z.string().trim().min(2).max(80),
  kilos: z.coerce.number().nonnegative().max(1_000_000_000),
  cantidad: z.coerce.number().int().nonnegative().max(1_000_000),
});

export const operacionEnvaseDetalleSchema =
  operacionEnvaseDetalleFormSchema.extend({
    envaseTipoCodigo: z.string().trim().min(2).max(32),
    envaseTipoNombre: z.string().trim().min(2).max(120),
  });

export const operacionLoteEnvasadoDetalleSchema = z.object({
  storedItemId: z.string().trim().min(1).max(200),
  procesoId: z.string().trim().min(1).max(200),
  salidaId: z.string().trim().min(1).max(200),
  cliente: z.string().trim().min(2).max(160),
  proceso: z.string().trim().min(2).max(160),
  producto: z.string().trim().min(2).max(160),
  procedencia: z.string().trim().min(2).max(160),
  envaseTipoId: z.string().trim().min(1).max(160),
  envaseTipoNombre: z.string().trim().min(1).max(160),
  envaseEstado: z.string().trim().min(1).max(80),
  envaseVisibleId: z.string().trim().min(1).max(200),
  pesoEnvaseKg: z.coerce.number().nonnegative().max(1_000_000_000),
  cantidad: z.coerce.number().int().positive().max(1_000_000),
  kilos: z.coerce.number().positive().max(1_000_000_000),
});

const operacionMercaderiaCamposFormSchema = z.object({
  fechaOperacion: fechaIsoSchema,
  numeroCartaPorte: z.string().trim().min(1).max(64),
  cliente: z.string().trim().min(2).max(160),
  proveedor: z.string().trim().min(2).max(160),
  proceso: z.string().trim().min(2).max(160),
  procedencia: z.string().trim().min(2).max(160),
  destinatario: z.string().trim().max(160).optional().default(""),
  producto: z.string().trim().min(2).max(160).optional(),
  kilos: z.coerce.number().positive().max(1_000_000_000),
  cantidadEnvases: z.coerce.number().int().nonnegative().max(1_000_000),
  envaseTipoId: z.string().trim().min(1),
  envaseEstado: z.string().trim().min(2).max(80),
  envaseMode: modoEnvasesOperacionSchema.optional().default("granel"),
  detalleEnvases: z
    .array(operacionEnvaseDetalleFormSchema)
    .optional()
    .default([]),
  loteEnvasadoDetalles: z
    .array(operacionLoteEnvasadoDetalleSchema)
    .optional()
    .default([]),
  observaciones: observacionesSchema,
});

export const operacionIngresoFormSchema =
  operacionMercaderiaCamposFormSchema.extend({
    tipoOperacion: z.literal("ingreso"),
  });

export const operacionEgresoFormSchema =
  operacionMercaderiaCamposFormSchema.extend({
    tipoOperacion: z.literal("egreso"),
    confirmarStockInsuficiente: z.coerce.boolean().optional().default(false),
  });

export const operacionMercaderiaFormSchema = z.discriminatedUnion(
  "tipoOperacion",
  [operacionIngresoFormSchema, operacionEgresoFormSchema],
);

export const operacionIngresoPersistenciaSchema =
  operacionIngresoFormSchema.extend({
    cartaPortePdf: cartaPorteArchivoSchema.optional(),
  });

export const operacionEgresoPersistenciaSchema =
  operacionEgresoFormSchema.extend({
    cartaPortePdf: cartaPorteArchivoSchema.optional(),
  });

export const operacionMercaderiaPersistenciaSchema = z.discriminatedUnion(
  "tipoOperacion",
  [operacionIngresoPersistenciaSchema, operacionEgresoPersistenciaSchema],
);

export const operacionMercaderiaSchema = z.object({
  tipoOperacion: tipoModuloOperacionSchema,
  fechaOperacion: firestoreTimestampLikeSchema,
  fechaKey: fechaIsoSchema,
  mesKey: z.string().regex(/^\d{4}-\d{2}$/),
  anioKey: z.string().regex(/^\d{4}$/),
  numeroCartaPorte: z.string().trim().min(1).max(64),
  numeroCartaPorteNormalizado: z.string().trim().min(1).max(64),
  cliente: z.string().trim().min(2).max(160),
  clienteNormalizado: textoNormalizadoSchema,
  proveedor: z
    .string()
    .trim()
    .min(2)
    .max(160)
    .optional()
    .default("No informado"),
  proveedorNormalizado: textoNormalizadoSchema.optional(),
  proceso: z.string().trim().min(2).max(160).optional(),
  procesoNormalizado: textoNormalizadoSchema.optional(),
  procedencia: z
    .string()
    .trim()
    .min(2)
    .max(160)
    .optional()
    .default("No informado"),
  procedenciaNormalizada: textoNormalizadoSchema.optional(),
  destinatario: z.string().trim().max(160).optional().default(""),
  destinatarioNormalizado: z.string().trim().max(160).optional().default(""),
  envaseEstado: z.string().trim().min(2).max(80).optional().default("Conforme"),
  producto: z.string().trim().min(2).max(160).optional(),
  productoNormalizado: textoNormalizadoSchema.optional(),
  kilos: z.number().positive().max(1_000_000_000),
  cantidadEnvases: z.number().int().nonnegative().max(1_000_000),
  envaseTipoId: z.string().trim().min(1),
  envaseTipoCodigo: z.string().trim().min(2).max(32),
  envaseTipoNombre: z.string().trim().min(2).max(120),
  detalleEnvases: z.array(operacionEnvaseDetalleSchema).optional().default([]),
  envaseMode: modoEnvasesOperacionSchema.optional().default("granel"),
  loteEnvasadoDetalles: z
    .array(operacionLoteEnvasadoDetalleSchema)
    .optional()
    .default([]),
  cartaPortePdf: cartaPorteArchivoSchema.optional(),
  observaciones: z.string().trim().max(1000).optional().nullable(),
  createdAt: firestoreTimestampLikeSchema.optional(),
  updatedAt: firestoreTimestampLikeSchema.optional(),
});

export const procesoSalidaFormSchema = z.object({
  id: z.string().trim().min(1).max(160).optional(),
  grado: gradoSalidaProcesoSchema,
  detalle: z.string().trim().min(1).max(160),
  kilos: z.coerce.number().nonnegative().max(1_000_000_000),
  cantidadEnvases: z.coerce.number().int().nonnegative().max(1_000_000).default(0),
  envaseTipoId: z.string().trim().max(160).optional().default(""),
  inventoryId: z.string().trim().max(200).optional().default(""),
  envaseEstado: z.string().trim().max(80).optional().default(""),
  envaseKilos: z.coerce.number().nonnegative().max(1_000_000_000).optional().default(0),
  envaseVisibleId: z.string().trim().max(200).optional().default(""),
});

export const procesoSalidaSchema = procesoSalidaFormSchema.extend({
  envaseTipoCodigo: z.string().trim().max(32).optional().default(""),
  envaseTipoNombre: z.string().trim().max(120).optional().default(""),
  estadoAlmacenamiento: estadoAlmacenamientoProcesoSchema
    .optional()
    .default("activo"),
  reprocessedAt: firestoreTimestampLikeSchema.optional(),
});

export const procesoRegistroFormSchema = z.object({
  fechaProceso: fechaIsoSchema,
  cliente: z.string().trim().min(2).max(160),
  proceso: z.string().trim().min(2).max(160),
  procedencia: z.string().trim().max(160).optional().default(""),
  producto: z.string().trim().max(160).optional().default(""),
  tipoOrden: tipoOrdenProcesoSchema,
  salidas: z.array(procesoSalidaFormSchema).min(1).max(40),
  observaciones: observacionesSchema,
});

export const procesoRegistroSchema = z.object({
  fechaProceso: firestoreTimestampLikeSchema,
  fechaKey: fechaIsoSchema,
  mesKey: z.string().regex(/^\d{4}-\d{2}$/),
  anioKey: z.string().regex(/^\d{4}$/),
  numeroProceso: z.string().trim().max(64).optional().default(""),
  numeroProcesoNormalizado: z.string().trim().max(64).optional().default(""),
  cliente: z.string().trim().min(2).max(160),
  clienteNormalizado: textoNormalizadoSchema,
  proceso: z.string().trim().max(160).optional().default(""),
  procesoNormalizado: textoNormalizadoSchema.optional().default(""),
  producto: z.string().trim().max(160).optional().default(""),
  productoNormalizado: textoNormalizadoSchema.optional().default(""),
  proveedor: z.string().trim().max(160).optional().default(""),
  proveedorNormalizado: textoNormalizadoSchema.optional().default(""),
  procedencia: z.string().trim().max(160).optional().default(""),
  procedenciaNormalizada: textoNormalizadoSchema.optional().default(""),
  tipoOrden: tipoOrdenProcesoSchema.optional().default("procesado"),
  tipoProceso: tipoProcesoRegistroSchema.optional().default("envasado"),
  tipoProcesoNormalizado: textoNormalizadoSchema.optional().default(""),
  kilos: z.number().nonnegative().max(1_000_000_000).optional().default(0),
  kilosTotal: z.number().nonnegative().max(1_000_000_000).optional().default(0),
  kilosProcesado: z
    .number()
    .nonnegative()
    .max(1_000_000_000)
    .optional()
    .default(0),
  kilosNoRecuperable: z
    .number()
    .nonnegative()
    .max(1_000_000_000)
    .optional()
    .default(0),
  kilosAlmacenados: z
    .number()
    .nonnegative()
    .max(1_000_000_000)
    .optional()
    .default(0),
  kilosReprocesados: z
    .number()
    .nonnegative()
    .max(1_000_000_000)
    .optional()
    .default(0),
  salidas: z.array(procesoSalidaSchema).optional().default([]),
  envaseTipoId: z.string().trim().optional().default(""),
  envaseTipoCodigo: z.string().trim().optional().default(""),
  envaseTipoNombre: z.string().trim().optional().default(""),
  envaseEstado: z.string().trim().optional().default(""),
  envaseKilos: z.number().nonnegative().max(1_000_000_000).optional().default(0),
  envaseCantidad: z.number().int().nonnegative().max(1_000_000).optional().default(0),
  observaciones: z.string().trim().max(1000).optional().nullable(),
  createdAt: firestoreTimestampLikeSchema.optional(),
  updatedAt: firestoreTimestampLikeSchema.optional(),
});

export const dashboardResumenDiarioSchema = z.object({
  fechaKey: fechaIsoSchema,
  mesKey: z.string().regex(/^\d{4}-\d{2}$/),
  anioKey: z.string().regex(/^\d{4}$/),
  totalOperacionesCarga: z.number().int().nonnegative().default(0),
  totalOperacionesDescarga: z.number().int().nonnegative().default(0),
  totalKilosCarga: z.number().nonnegative().default(0),
  totalKilosDescarga: z.number().nonnegative().default(0),
  totalEnvasesCarga: z.number().int().nonnegative().default(0),
  totalEnvasesDescarga: z.number().int().nonnegative().default(0),
  updatedAt: firestoreTimestampLikeSchema.optional(),
});

export type TipoModuloOperacion = z.infer<typeof tipoModuloOperacionSchema>;
export type TipoOperacion = z.infer<typeof tipoOperacionSchema>;
export type TipoProcesoRegistro = z.infer<typeof tipoProcesoRegistroSchema>;
export type TipoOrdenProceso = z.infer<typeof tipoOrdenProcesoSchema>;
export type GradoSalidaProceso = z.infer<typeof gradoSalidaProcesoSchema>;
export type EstadoAlmacenamientoProceso = z.infer<
  typeof estadoAlmacenamientoProcesoSchema
>;
export type TipoMovimientoEnvase = z.infer<typeof tipoMovimientoEnvaseSchema>;
export type TipoRegistroHistorialEnvase = z.infer<
  typeof tipoRegistroHistorialEnvaseSchema
>;
export type OrigenHistorialEnvase = z.infer<typeof origenHistorialEnvaseSchema>;
export type OrigenMovimientoEnvase = z.infer<
  typeof origenMovimientoEnvaseSchema
>;
export type ModoEnvasesOperacion = z.infer<typeof modoEnvasesOperacionSchema>;
export type PackagingMovementType = z.infer<typeof packagingMovementTypeSchema>;
export type PackagingType = z.infer<typeof packagingTypeSchema>;
export type PackagingCondition = z.infer<typeof packagingConditionSchema>;
export type PackagingMovement = z.infer<typeof packagingMovementSchema>;
export type CartaPorteArchivo = z.infer<typeof cartaPorteArchivoSchema>;
export type DescargaLegacy = z.infer<typeof descargaLegacySchema>;
export type DefectoLegacy = z.infer<typeof defectoLegacySchema>;
export type MuestraLegacy = z.infer<typeof muestraLegacySchema>;
export type UsuarioLegacy = z.infer<typeof usuarioLegacySchema>;
export type EnvaseTipo = z.infer<typeof envaseTipoSchema>;
export type EnvaseStock = z.infer<typeof envaseStockSchema>;
export type Envase = z.infer<typeof envaseSchema>;
export type EnvaseFormInput = z.infer<typeof envaseFormSchema>;
export type EnvaseIngresoManualFormInput = z.infer<
  typeof envaseIngresoManualFormSchema
>;
export type EnvaseBajaFormInput = z.infer<typeof envaseBajaFormSchema>;
export type EnvaseMovimiento = z.infer<typeof envaseMovimientoSchema>;
export type EnvaseHistorialMovimiento = z.infer<
  typeof envaseHistorialMovimientoSchema
>;
export type OperacionEnvaseDetalleFormInput = z.infer<
  typeof operacionEnvaseDetalleFormSchema
>;
export type OperacionEnvaseDetalle = z.infer<
  typeof operacionEnvaseDetalleSchema
>;
export type OperacionLoteEnvasadoDetalle = z.infer<
  typeof operacionLoteEnvasadoDetalleSchema
>;
export type OperacionMercaderia = z.infer<typeof operacionMercaderiaSchema>;
export type ProcesoRegistro = z.infer<typeof procesoRegistroSchema>;
export type ProcesoSalida = z.infer<typeof procesoSalidaSchema>;
export type OperacionMercaderiaFormInput = z.infer<
  typeof operacionMercaderiaFormSchema
>;
export type ProcesoRegistroFormInput = z.infer<
  typeof procesoRegistroFormSchema
>;
export type ProcesoSalidaFormInput = z.infer<typeof procesoSalidaFormSchema>;
export type OperacionIngresoFormInput = z.infer<
  typeof operacionIngresoFormSchema
>;
export type OperacionEgresoFormInput = z.infer<
  typeof operacionEgresoFormSchema
>;
export type OperacionIngresoPersistenciaInput = z.infer<
  typeof operacionIngresoPersistenciaSchema
>;
export type OperacionEgresoPersistenciaInput = z.infer<
  typeof operacionEgresoPersistenciaSchema
>;
export type OperacionMercaderiaPersistenciaInput = z.infer<
  typeof operacionMercaderiaPersistenciaSchema
>;
export type DashboardResumenDiario = z.infer<
  typeof dashboardResumenDiarioSchema
>;

// Alias heredados para que las integraciones antiguas compilen durante la migracion.
export const operacionSchema = operacionMercaderiaSchema;
export const operacionCargaFormSchema = operacionEgresoFormSchema;
export const operacionCargaPersistenciaSchema =
  operacionEgresoPersistenciaSchema;
export type Operacion = OperacionMercaderia;
export type OperacionCargaFormInput = OperacionEgresoFormInput;
export type OperacionCargaPersistenciaInput = OperacionEgresoPersistenciaInput;

export type ActionState<TData = undefined> =
  | {
      ok: true;
      message: string;
      data: TData;
    }
  | {
      ok: false;
      message: string;
      fieldErrors?: Record<string, string[] | undefined>;
    };
