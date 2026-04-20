import "server-only";

import { getOptionalPublicFirebaseConfig } from "@/lib/firebase/public-config";
import { getFirebaseSystemConfig } from "@/lib/firebase/system-config";
import { getModuloOperacionData, getEnvasesOperativos } from "@/lib/services/operaciones";
import { crearResumenDiarioVacio } from "@/lib/utils";
import type { DashboardResumenDiario } from "@/types/schema";

type DashboardOverview = {
  fechaActual: string;
  firestoreDisponible: boolean;
  storageConfigurado: boolean;
  resumenHoy: DashboardResumenDiario;
  ingresosHoy: number;
  egresosHoy: number;
  kilosIngresadosHoy: number;
  kilosEgresadosHoy: number;
  stockTotal: number;
  envasesActivos: number;
};

export async function getDashboardOverview(): Promise<DashboardOverview> {
  const fechaActual = new Date().toISOString().slice(0, 10);
  const emptyResumen = crearResumenDiarioVacio(fechaActual);
  const publicFirebaseConfig = getOptionalPublicFirebaseConfig();
  const systemConfig = getFirebaseSystemConfig();

  try {
    const [ingresos, egresos, envases] = await Promise.all([
      getModuloOperacionData("ingreso"),
      getModuloOperacionData("egreso"),
      getEnvasesOperativos()
    ]);

    return {
      fechaActual,
      firestoreDisponible:
        ingresos.firestoreDisponible || egresos.firestoreDisponible,
      storageConfigurado:
        ingresos.storageConfigurado || egresos.storageConfigurado,
      resumenHoy: egresos.resumenHoy ?? ingresos.resumenHoy ?? emptyResumen,
      ingresosHoy: ingresos.resumenHoy.totalOperacionesDescarga,
      egresosHoy: egresos.resumenHoy.totalOperacionesCarga,
      kilosIngresadosHoy: ingresos.resumenHoy.totalKilosDescarga,
      kilosEgresadosHoy: egresos.resumenHoy.totalKilosCarga,
      stockTotal: envases.reduce((total, envase) => total + envase.stockActual, 0),
      envasesActivos: envases.length
    };
  } catch {
    return {
      fechaActual,
      firestoreDisponible: false,
      storageConfigurado: Boolean(
        process.env.FIREBASE_STORAGE_BUCKET?.trim() ??
          systemConfig.storageBucket ??
          publicFirebaseConfig.storageBucket
      ),
      resumenHoy: emptyResumen,
      ingresosHoy: 0,
      egresosHoy: 0,
      kilosIngresadosHoy: 0,
      kilosEgresadosHoy: 0,
      stockTotal: 0,
      envasesActivos: 0
    };
  }
}
