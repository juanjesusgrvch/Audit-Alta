import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import { crearResumenDiarioVacio, timestampLikeToDate } from "@/lib/utils";
import {
  COLLECTIONS,
  dashboardResumenDiarioSchema,
  envaseStockSchema,
  envaseTipoSchema,
  operacionSchema,
  type DashboardResumenDiario,
  type EnvaseStock,
  type EnvaseTipo,
  type Operacion
} from "@/types/schema";

type DashboardOverview = {
  fechaActual: string;
  firestoreDisponible: boolean;
  storageConfigurado: boolean;
  envaseTiposActivos: Array<
    Pick<EnvaseTipo, "codigo" | "nombre" | "descripcion" | "controlaStock"> & {
      id: string;
    }
  >;
  stock: Array<
    Pick<
      EnvaseStock,
      "envaseTipoNombre" | "envaseTipoCodigo" | "stockActual" | "egresosAcumulados"
    > & {
      id: string;
      updatedAt: Date | null;
    }
  >;
  resumenHoy: DashboardResumenDiario;
  operacionesRecientes: Array<
    Pick<
      Operacion,
      | "cliente"
      | "producto"
      | "numeroCartaPorte"
      | "cantidadEnvases"
      | "kilos"
      | "envaseTipoNombre"
    > & {
      id: string;
      createdAt: Date | null;
    }
  >;
};

export async function getDashboardOverview(): Promise<DashboardOverview> {
  const fechaActual = new Date().toISOString().slice(0, 10);

  const emptyState: DashboardOverview = {
    fechaActual,
    firestoreDisponible: false,
    storageConfigurado: Boolean(
      process.env.FIREBASE_STORAGE_BUCKET ??
        process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
    ),
    envaseTiposActivos: [],
    stock: [],
    resumenHoy: crearResumenDiarioVacio(fechaActual),
    operacionesRecientes: []
  };

  try {
    const db = getAdminDb();
    const [envaseTiposSnap, stockSnap, resumenHoySnap, operacionesSnap] =
      await Promise.all([
        db
          .collection(COLLECTIONS.envaseTipos)
          .where("activo", "==", true)
          .orderBy("orden", "asc")
          .limit(8)
          .get(),
        db
          .collection(COLLECTIONS.envaseStock)
          .orderBy("stockActual", "asc")
          .limit(8)
          .get(),
        db.collection(COLLECTIONS.dashboardResumenDiario).doc(fechaActual).get(),
        db
          .collection(COLLECTIONS.operaciones)
          .orderBy("createdAt", "desc")
          .limit(5)
          .get()
      ]);

    const envaseTiposActivos = envaseTiposSnap.docs.flatMap((documento) => {
      const parsed = envaseTipoSchema.safeParse(documento.data());

      if (!parsed.success) {
        return [];
      }

      return [
        {
          id: documento.id,
          codigo: parsed.data.codigo,
          nombre: parsed.data.nombre,
          descripcion: parsed.data.descripcion,
          controlaStock: parsed.data.controlaStock
        }
      ];
    });

    const stock = stockSnap.docs.flatMap((documento) => {
      const parsed = envaseStockSchema.safeParse(documento.data());

      if (!parsed.success) {
        return [];
      }

      return [
        {
          id: documento.id,
          envaseTipoNombre: parsed.data.envaseTipoNombre,
          envaseTipoCodigo: parsed.data.envaseTipoCodigo,
          stockActual: parsed.data.stockActual,
          egresosAcumulados: parsed.data.egresosAcumulados,
          updatedAt: timestampLikeToDate(parsed.data.updatedAt)
        }
      ];
    });

    const resumenHoy = resumenHoySnap.exists
      ? dashboardResumenDiarioSchema.safeParse(resumenHoySnap.data()).success
        ? dashboardResumenDiarioSchema.parse(resumenHoySnap.data())
        : crearResumenDiarioVacio(fechaActual)
      : crearResumenDiarioVacio(fechaActual);

    const operacionesRecientes = operacionesSnap.docs.flatMap((documento) => {
      const parsed = operacionSchema.safeParse(documento.data());

      if (!parsed.success) {
        return [];
      }

      return [
        {
          id: documento.id,
          cliente: parsed.data.cliente,
          producto: parsed.data.producto,
          numeroCartaPorte: parsed.data.numeroCartaPorte,
          cantidadEnvases: parsed.data.cantidadEnvases,
          kilos: parsed.data.kilos,
          envaseTipoNombre: parsed.data.envaseTipoNombre,
          createdAt: timestampLikeToDate(parsed.data.createdAt)
        }
      ];
    });

    return {
      fechaActual,
      firestoreDisponible: true,
      storageConfigurado: emptyState.storageConfigurado,
      envaseTiposActivos,
      stock,
      resumenHoy,
      operacionesRecientes
    };
  } catch {
    return emptyState;
  }
}
