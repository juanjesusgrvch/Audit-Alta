import { z } from "zod";

const MAX_PDF_BYTES = 10 * 1024 * 1024;

const fechaIsoSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener formato YYYY-MM-DD.");

const firestoreTimestampLikeSchema = z.union([
  z.date(),
  z
    .object({
      seconds: z.number(),
      nanoseconds: z.number()
    })
    .passthrough(),
  z
    .object({
      _seconds: z.number(),
      _nanoseconds: z.number()
    })
    .passthrough()
]);

const textoNormalizadoSchema = z.string().trim().min(1).max(160);
const observacionesSchema = z
  .string()
  .trim()
  .max(1000)
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

export const COLLECTIONS = {
  operaciones: "operaciones",
  operacionesKeys: "operaciones_keys",
  envaseTipos: "envase_tipos",
  envaseMovimientos: "envase_movimientos",
  envaseStock: "envase_stock",
  dashboardResumenDiario: "dashboard_resumen_diario"
} as const;

export const tipoOperacionSchema = z.enum(["descarga", "carga"]);
export const tipoMovimientoEnvaseSchema = z.enum([
  "ingreso",
  "egreso",
  "ajuste_manual"
]);

export const origenMovimientoEnvaseSchema = z.enum([
  "operacion_descarga",
  "operacion_carga",
  "ajuste_manual"
]);

export const cartaPorteArchivoSchema = z.object({
  storagePath: z.string().trim().min(1).max(512),
  downloadUrl: z.string().url(),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.literal("application/pdf"),
  sizeBytes: z.number().int().positive().max(MAX_PDF_BYTES)
});

export const envaseTipoSchema = z.object({
  codigo: z.string().trim().min(2).max(32),
  nombre: z.string().trim().min(2).max(120),
  descripcion: z.string().trim().max(240).optional(),
  controlaStock: z.boolean().default(true),
  activo: z.boolean().default(true),
  orden: z.number().int().nonnegative().default(0),
  createdAt: firestoreTimestampLikeSchema.optional(),
  updatedAt: firestoreTimestampLikeSchema.optional()
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
  version: z.number().int().nonnegative().default(0)
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
  createdAt: firestoreTimestampLikeSchema.optional()
});

export const operacionBaseFormSchema = z.object({
  fechaOperacion: fechaIsoSchema,
  numeroCartaPorte: z.string().trim().min(1).max(64),
  cliente: z.string().trim().min(2).max(160),
  producto: z.string().trim().min(2).max(160),
  kilos: z.coerce.number().positive().max(1_000_000_000),
  cantidadEnvases: z.coerce.number().int().positive().max(1_000_000),
  envaseTipoId: z.string().trim().min(1),
  observaciones: observacionesSchema
});

export const operacionBasePersistenciaSchema = operacionBaseFormSchema.extend({
  cartaPortePdf: cartaPorteArchivoSchema
});

export const operacionSchema = operacionBasePersistenciaSchema.extend({
  tipoOperacion: tipoOperacionSchema,
  fechaOperacion: firestoreTimestampLikeSchema,
  fechaKey: fechaIsoSchema,
  mesKey: z.string().regex(/^\d{4}-\d{2}$/),
  anioKey: z.string().regex(/^\d{4}$/),
  clienteNormalizado: textoNormalizadoSchema,
  productoNormalizado: textoNormalizadoSchema,
  numeroCartaPorteNormalizado: z.string().trim().min(1).max(64),
  envaseTipoCodigo: z.string().trim().min(2).max(32),
  envaseTipoNombre: z.string().trim().min(2).max(120),
  createdAt: firestoreTimestampLikeSchema.optional(),
  updatedAt: firestoreTimestampLikeSchema.optional()
});

export const operacionCargaFormSchema = operacionBaseFormSchema.extend({
  tipoOperacion: z.literal("carga")
});

export const operacionCargaPersistenciaSchema =
  operacionBasePersistenciaSchema.extend({
    tipoOperacion: z.literal("carga")
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
  updatedAt: firestoreTimestampLikeSchema.optional()
});

export type TipoOperacion = z.infer<typeof tipoOperacionSchema>;
export type TipoMovimientoEnvase = z.infer<typeof tipoMovimientoEnvaseSchema>;
export type OrigenMovimientoEnvase = z.infer<typeof origenMovimientoEnvaseSchema>;
export type CartaPorteArchivo = z.infer<typeof cartaPorteArchivoSchema>;
export type EnvaseTipo = z.infer<typeof envaseTipoSchema>;
export type EnvaseStock = z.infer<typeof envaseStockSchema>;
export type EnvaseMovimiento = z.infer<typeof envaseMovimientoSchema>;
export type Operacion = z.infer<typeof operacionSchema>;
export type OperacionCargaFormInput = z.infer<typeof operacionCargaFormSchema>;
export type OperacionCargaPersistenciaInput = z.infer<
  typeof operacionCargaPersistenciaSchema
>;
export type DashboardResumenDiario = z.infer<typeof dashboardResumenDiarioSchema>;

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
