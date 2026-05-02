"use client";

import { useEffect, useState } from "react";
import { fetchWithFirebaseAuth } from "@/lib/client/auth-fetch";
import type { EnvasesLedgerHistoryRecord } from "@/lib/services/envases-module";
import { fechaIsoLocalToDate } from "@/lib/utils";
import type {
  EnvaseOption,
  RegistroOperacion
} from "@/lib/services/operaciones";
import type { RegistroProceso } from "@/lib/services/procesos";
import type { TipoModuloOperacion } from "@/types/schema";

type ModuleKey = "descargas" | "cargas" | "envases" | "procesos";

type SerializedEnvaseOption = Omit<EnvaseOption, "updatedAt"> & {
  updatedAt: string | null;
};

type SerializedRegistroOperacion = Omit<
  RegistroOperacion,
  "fechaOperacion" | "createdAt"
> & {
  fechaOperacion: string | null;
  createdAt: string | null;
};

type SerializedRegistroProceso = Omit<
  RegistroProceso,
  "fechaProceso" | "createdAt"
> & {
  fechaProceso: string | null;
  createdAt: string | null;
};

type SerializedEnvaseHistory = Omit<
  EnvasesLedgerHistoryRecord,
  "fechaMovimiento" | "createdAt"
> & {
  fechaMovimiento: string | null;
  createdAt: string | null;
};

type OperacionModulePayload = {
  tipo: TipoModuloOperacion;
  firestoreDisponible: boolean;
  storageConfigurado: boolean;
  envases: SerializedEnvaseOption[];
  registros: SerializedRegistroOperacion[];
};

type EnvasesModulePayload = {
  firestoreDisponible: boolean;
  envases: SerializedEnvaseOption[];
  clientesDisponibles: string[];
  stockPlanta: Array<{
    kg: number;
    totalCantidad: number;
    totalRegistros: number;
    entries: Array<{
      inventoryId: string;
      visibleId: string;
      envaseTipoId: string;
      envaseTipoCodigo: string;
      envaseTipoNombre: string;
      envaseEstado: string;
      kilos: number;
      cantidad: number;
      transactionCount: number;
    }>;
  }>;
  historialDerivado: SerializedEnvaseHistory[];
};

type ProcessModulePayload = {
  firestoreDisponible: boolean;
  envases: SerializedEnvaseOption[];
  registros: SerializedRegistroProceso[];
};

type OperationModuleData = {
  tipo: TipoModuloOperacion;
  firestoreDisponible: boolean;
  storageConfigurado: boolean;
  envases: EnvaseOption[];
  registros: RegistroOperacion[];
};

type EnvasesModuleData = {
  firestoreDisponible: boolean;
  envases: EnvaseOption[];
  clientesDisponibles: string[];
  stockPlanta: EnvasesModulePayload["stockPlanta"];
  historialDerivado: EnvasesLedgerHistoryRecord[];
};

type ProcessModuleData = {
  firestoreDisponible: boolean;
  envases: EnvaseOption[];
  registros: RegistroProceso[];
};

type CacheEntry<TData> = {
  data: TData | null;
  error: string | null;
  promise: Promise<void> | null;
  status: "idle" | "loading" | "ready" | "error";
};

const MODULE_ENDPOINTS: Record<ModuleKey, string> = {
  descargas: "/api/descargas",
  cargas: "/api/cargas",
  envases: "/api/envases",
  procesos: "/api/procesos"
};

const moduleCache = new Map<
  ModuleKey,
  CacheEntry<OperationModuleData | EnvasesModuleData | ProcessModuleData>
>();
const moduleListeners = new Map<ModuleKey, Set<() => void>>();

function toDate(value: string | null) {
  return value ? new Date(value) : null;
}

function toCalendarDate(value: string | null, fechaKey?: string | null) {
  if (fechaKey) {
    try {
      return fechaIsoLocalToDate(fechaKey);
    } catch {
      return toDate(value);
    }
  }

  return toDate(value);
}

function parseEnvase(envase: SerializedEnvaseOption): EnvaseOption {
  return {
    ...envase,
    updatedAt: toDate(envase.updatedAt)
  };
}

function parseRegistro(
  registro: SerializedRegistroOperacion
): RegistroOperacion {
  return {
    ...registro,
    fechaOperacion: toCalendarDate(registro.fechaOperacion, registro.fechaKey),
    createdAt: toDate(registro.createdAt)
  };
}

function parseProceso(
  registro: SerializedRegistroProceso
): RegistroProceso {
  return {
    ...registro,
    fechaProceso: toCalendarDate(registro.fechaProceso, registro.fechaKey),
    createdAt: toDate(registro.createdAt)
  };
}

function parseEnvaseHistory(
  registro: SerializedEnvaseHistory
): EnvasesLedgerHistoryRecord {
  return {
    ...registro,
    fechaMovimiento: toCalendarDate(registro.fechaMovimiento, registro.fechaKey),
    createdAt: toDate(registro.createdAt)
  };
}

function parseModuleData(
  key: "descargas" | "cargas",
  payload: OperacionModulePayload
): OperationModuleData {
  return {
    tipo: payload.tipo,
    firestoreDisponible: payload.firestoreDisponible,
    storageConfigurado: payload.storageConfigurado,
    envases: payload.envases.map(parseEnvase),
    registros: payload.registros.map(parseRegistro)
  };
}

function parseEnvasesData(payload: EnvasesModulePayload): EnvasesModuleData {
  return {
    firestoreDisponible: payload.firestoreDisponible,
    envases: payload.envases.map(parseEnvase),
    clientesDisponibles: payload.clientesDisponibles,
    stockPlanta: payload.stockPlanta,
    historialDerivado: payload.historialDerivado.map(parseEnvaseHistory)
  };
}

function parseProcessData(payload: ProcessModulePayload): ProcessModuleData {
  return {
    firestoreDisponible: payload.firestoreDisponible,
    envases: payload.envases.map(parseEnvase),
    registros: payload.registros.map(parseProceso)
  };
}

function getCacheEntry<TData>(key: ModuleKey): CacheEntry<TData> {
  const currentEntry = moduleCache.get(key);

  if (currentEntry) {
    return currentEntry as CacheEntry<TData>;
  }

  const nextEntry: CacheEntry<TData> = {
    data: null,
    error: null,
    promise: null,
    status: "idle"
  };

  moduleCache.set(
    key,
    nextEntry as CacheEntry<
      OperationModuleData | EnvasesModuleData | ProcessModuleData
    >
  );
  return nextEntry;
}

function emitModuleUpdate(key: ModuleKey) {
  const listeners = moduleListeners.get(key);

  if (!listeners) {
    return;
  }

  for (const listener of listeners) {
    listener();
  }
}

function subscribeModule(key: ModuleKey, listener: () => void) {
  const listeners = moduleListeners.get(key) ?? new Set<() => void>();
  listeners.add(listener);
  moduleListeners.set(key, listeners);

  return () => {
    listeners.delete(listener);

    if (listeners.size === 0) {
      moduleListeners.delete(key);
    }
  };
}

async function fetchModule(
  key: ModuleKey
): Promise<OperationModuleData | EnvasesModuleData | ProcessModuleData> {
  const response = await fetchWithFirebaseAuth(MODULE_ENDPOINTS[key], {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`No fue posible cargar ${key}.`);
  }

  const payload = await response.json();

  if (key === "envases") {
    return parseEnvasesData(payload as EnvasesModulePayload);
  }

  if (key === "procesos") {
    return parseProcessData(payload as ProcessModulePayload);
  }

  return parseModuleData(key, payload as OperacionModulePayload);
}

async function loadModule(key: ModuleKey, force = false) {
  const entry = getCacheEntry<
    OperationModuleData | EnvasesModuleData | ProcessModuleData
  >(key);

  if (entry.promise && !force) {
    return entry.promise;
  }

  if (entry.status === "ready" && entry.data && !force) {
    return Promise.resolve();
  }

  entry.status = "loading";
  entry.error = null;
  emitModuleUpdate(key);

  entry.promise = fetchModule(key)
    .then((data) => {
      entry.data = data;
      entry.status = "ready";
      entry.error = null;
    })
    .catch((error) => {
      entry.status = "error";
      entry.error =
        error instanceof Error ? error.message : "No fue posible cargar el modulo.";
    })
    .finally(() => {
      entry.promise = null;
      emitModuleUpdate(key);
    });

  return entry.promise;
}

export function preloadAllModuleData() {
  for (const key of Object.keys(MODULE_ENDPOINTS) as ModuleKey[]) {
    void loadModule(key);
  }
}

export function preloadModuleData(key: ModuleKey) {
  void loadModule(key);
}

export function refreshModuleData(key: ModuleKey) {
  return loadModule(key, true);
}

export function refreshAllModuleData() {
  for (const key of Object.keys(MODULE_ENDPOINTS) as ModuleKey[]) {
    void loadModule(key, true);
  }
}

export function useOperationModuleData(tipo: TipoModuloOperacion) {
  const key: ModuleKey = tipo === "ingreso" ? "descargas" : "cargas";
  const [entry, setEntry] = useState(() =>
    getCacheEntry<OperationModuleData>(key)
  );

  useEffect(() => {
    setEntry({ ...getCacheEntry<OperationModuleData>(key) });

    const unsubscribe = subscribeModule(key, () => {
      setEntry({ ...getCacheEntry<OperationModuleData>(key) });
    });

    void loadModule(key);

    return unsubscribe;
  }, [key]);

  return {
    data: entry.data,
    error: entry.error,
    isLoading: entry.status === "loading" || entry.status === "idle",
    refresh: () => refreshModuleData(key)
  };
}

export function useEnvasesModuleData() {
  const key: ModuleKey = "envases";
  const [entry, setEntry] = useState(() =>
    getCacheEntry<EnvasesModuleData>(key)
  );

  useEffect(() => {
    setEntry({ ...getCacheEntry<EnvasesModuleData>(key) });

    const unsubscribe = subscribeModule(key, () => {
      setEntry({ ...getCacheEntry<EnvasesModuleData>(key) });
    });

    void loadModule(key);

    return unsubscribe;
  }, [key]);

  return {
    data: entry.data,
    error: entry.error,
    isLoading: entry.status === "loading" || entry.status === "idle",
    refresh: () => refreshModuleData(key)
  };
}

export function useProcesosModuleData() {
  const key: ModuleKey = "procesos";
  const [entry, setEntry] = useState(() =>
    getCacheEntry<ProcessModuleData>(key)
  );

  useEffect(() => {
    setEntry({ ...getCacheEntry<ProcessModuleData>(key) });

    const unsubscribe = subscribeModule(key, () => {
      setEntry({ ...getCacheEntry<ProcessModuleData>(key) });
    });

    void loadModule(key);

    return unsubscribe;
  }, [key]);

  return {
    data: entry.data,
    error: entry.error,
    isLoading: entry.status === "loading" || entry.status === "idle",
    refresh: () => refreshModuleData(key)
  };
}
