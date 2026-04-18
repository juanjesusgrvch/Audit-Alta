import "server-only";

import type {
  EnvasesDashboardData,
  EnvasesLedgerHistoryRecord
} from "@/lib/services/envases-module";
import type {
  EnvaseOption,
  ModuloOperacionData,
  RegistroOperacion
} from "@/lib/services/operaciones";
import type {
  ModuloProcesosData,
  RegistroProceso
} from "@/lib/services/procesos";

function serializeDate(value: Date | null) {
  return value ? value.toISOString() : null;
}

function serializeEnvase(envase: EnvaseOption) {
  return {
    ...envase,
    updatedAt: serializeDate(envase.updatedAt)
  };
}

function serializeRegistro(registro: RegistroOperacion) {
  return {
    ...registro,
    fechaOperacion: serializeDate(registro.fechaOperacion),
    createdAt: serializeDate(registro.createdAt)
  };
}

function serializeProceso(registro: RegistroProceso) {
  return {
    ...registro,
    fechaProceso: serializeDate(registro.fechaProceso),
    createdAt: serializeDate(registro.createdAt)
  };
}

function serializeEnvaseHistory(registro: EnvasesLedgerHistoryRecord) {
  return {
    ...registro,
    fechaMovimiento: serializeDate(registro.fechaMovimiento),
    createdAt: serializeDate(registro.createdAt)
  };
}

export function serializeModuloOperacionData(data: ModuloOperacionData) {
  return {
    tipo: data.tipo,
    firestoreDisponible: data.firestoreDisponible,
    storageConfigurado: data.storageConfigurado,
    resumenHoy: data.resumenHoy,
    envases: data.envases.map(serializeEnvase),
    registros: data.registros.map(serializeRegistro)
  };
}

export function serializeEnvasesPageData(data: {
  firestoreDisponible: boolean;
  envases: EnvaseOption[];
  historialDerivado?: EnvasesLedgerHistoryRecord[];
  clientesDisponibles?: string[];
  stockPlanta?: EnvasesDashboardData["stockPlanta"];
}) {
  return {
    firestoreDisponible: data.firestoreDisponible,
    envases: data.envases.map(serializeEnvase),
    clientesDisponibles: data.clientesDisponibles ?? [],
    stockPlanta: data.stockPlanta ?? [],
    historialDerivado: (data.historialDerivado ?? []).map(serializeEnvaseHistory)
  };
}

export function serializeProcesosModuleData(data: ModuloProcesosData) {
  return {
    firestoreDisponible: data.firestoreDisponible,
    envases: data.envases.map(serializeEnvase),
    registros: data.registros.map(serializeProceso)
  };
}

export function serializeEnvasesDashboardData(data: EnvasesDashboardData) {
  return {
    firestoreDisponible: data.firestoreDisponible,
    envases: data.envases.map(serializeEnvase),
    clientesDisponibles: data.clientesDisponibles,
    stockPlanta: data.stockPlanta,
    historialDerivado: data.historialDerivado.map(serializeEnvaseHistory)
  };
}
