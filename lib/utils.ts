import type { DashboardResumenDiario } from "@/types/schema";

type TimestampLike =
  | Date
  | string
  | {
      seconds: number;
      nanoseconds: number;
    }
  | {
      _seconds: number;
      _nanoseconds: number;
    }
  | null
  | undefined;

const numberFormatter = new Intl.NumberFormat("es-AR");
const kilosFormatter = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 2
});
const dateTimeFormatter = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short"
});

export function esFechaIsoLocal(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsedDate = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().startsWith(value);
}

export function construirClavesFecha(fechaOperacion: string) {
  if (!esFechaIsoLocal(fechaOperacion)) {
    throw new Error("La fecha de operacion no tiene un formato valido.");
  }

  return {
    fechaKey: fechaOperacion,
    mesKey: fechaOperacion.slice(0, 7),
    anioKey: fechaOperacion.slice(0, 4)
  };
}

export function normalizarTextoParaIndice(value: string): string {
  return compactarEspacios(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function compactarEspacios(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ");
}

export function sanearSegmentoArchivo(value: string, fallback = "archivo"): string {
  const sanitized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized || fallback;
}

export function quitarExtensionArchivo(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

export function timestampLikeToDate(value: TimestampLike): Date | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if ("seconds" in value) {
    return new Date(value.seconds * 1000);
  }

  if ("_seconds" in value) {
    return new Date(value._seconds * 1000);
  }

  return null;
}

export function formatearFechaHora(value: TimestampLike): string {
  const parsedDate = timestampLikeToDate(value);

  if (!parsedDate) {
    return "Sin fecha";
  }

  return dateTimeFormatter.format(parsedDate);
}

export function formatearEntero(value: number): string {
  return numberFormatter.format(value);
}

export function formatearKilos(value: number): string {
  return kilosFormatter.format(value);
}

export function crearResumenDiarioVacio(fechaKey: string): DashboardResumenDiario {
  const { mesKey, anioKey } = construirClavesFecha(fechaKey);

  return {
    fechaKey,
    mesKey,
    anioKey,
    totalOperacionesCarga: 0,
    totalOperacionesDescarga: 0,
    totalKilosCarga: 0,
    totalKilosDescarga: 0,
    totalEnvasesCarga: 0,
    totalEnvasesDescarga: 0
  };
}
