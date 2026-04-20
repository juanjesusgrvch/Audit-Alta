import "server-only";

import { NextResponse } from "next/server";
import { eliminarCartaDePorte, subirCartaDePortePdf } from "@/lib/services/storage";
import type { ActionState } from "@/types/schema";

type CrearOperacionHandler<TData> = (
  input: unknown,
  actorUid?: string
) => Promise<ActionState<TData>>;

type BuildOperacionRouteParams<TData> = {
  request: Request;
  tipoOperacion: "ingreso" | "egreso";
  onCreate: CrearOperacionHandler<TData>;
  errorMessage: string;
  actorUid?: string;
  requireCartaPortePdf?: boolean;
};

function getStringValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function getFileValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File ? value : null;
}

function parseDetalleEnvases(formData: FormData) {
  const rawValue = formData.get("detalleEnvases");

  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    return [];
  }

  const parsedValue = JSON.parse(rawValue);

  if (!Array.isArray(parsedValue)) {
    throw new Error("El detalle de envases no tiene un formato valido.");
  }

  return parsedValue;
}

function parseJsonArrayField(formData: FormData, key: string) {
  const rawValue = formData.get(key);

  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    return [];
  }

  const parsedValue = JSON.parse(rawValue);

  if (!Array.isArray(parsedValue)) {
    throw new Error(`El campo ${key} no tiene un formato valido.`);
  }

  return parsedValue;
}

export async function handleOperacionRequest<TData>({
  request,
  tipoOperacion,
  onCreate,
  errorMessage,
  actorUid,
  requireCartaPortePdf = true
}: BuildOperacionRouteParams<TData>) {
  let uploadedStoragePath: string | null = null;

  try {
    const formData = await request.formData();
    const detalleEnvases = parseDetalleEnvases(formData);
    const loteEnvasadoDetalles = parseJsonArrayField(
      formData,
      "loteEnvasadoDetalles",
    );
    const envaseMode = getStringValue(formData, "envaseMode").trim();
    const fields = {
      tipoOperacion,
      fechaOperacion: getStringValue(formData, "fechaOperacion"),
      numeroCartaPorte: getStringValue(formData, "numeroCartaPorte"),
      cliente: getStringValue(formData, "cliente"),
      proveedor: getStringValue(formData, "proveedor"),
      proceso: getStringValue(formData, "proceso"),
      procedencia: getStringValue(formData, "procedencia"),
      destinatario: getStringValue(formData, "destinatario"),
      producto: getStringValue(formData, "producto"),
      kilos: getStringValue(formData, "kilos"),
      cantidadEnvases: getStringValue(formData, "cantidadEnvases"),
      envaseTipoId: getStringValue(formData, "envaseTipoId"),
      envaseEstado: getStringValue(formData, "envaseEstado"),
      envaseMode: envaseMode.length > 0 ? envaseMode : undefined,
      detalleEnvases,
      loteEnvasadoDetalles,
      observaciones: getStringValue(formData, "observaciones")
    };
    const file = getFileValue(formData, "cartaPortePdf");

    if (!file && requireCartaPortePdf) {
      return NextResponse.json<ActionState<TData>>(
        {
          ok: false,
          message: "La Carta de Porte en PDF es obligatoria.",
          fieldErrors: {
            cartaPortePdf: ["La Carta de Porte en PDF es obligatoria."]
          }
        },
        { status: 400 }
      );
    }

    const cartaPortePdf = file
      ? await subirCartaDePortePdf({
          file,
          numeroCartaPorte: fields.numeroCartaPorte,
          fechaOperacion: fields.fechaOperacion
        })
      : undefined;

    if (cartaPortePdf) {
      uploadedStoragePath = cartaPortePdf.storagePath;
    }

    const result = await onCreate(
      {
        ...fields,
        cartaPortePdf
      },
      actorUid
    );

    if (!result.ok) {
      if (cartaPortePdf) {
        await eliminarCartaDePorte(cartaPortePdf.storagePath);
      }

      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    if (uploadedStoragePath) {
      await eliminarCartaDePorte(uploadedStoragePath).catch(() => undefined);
    }

    return NextResponse.json<ActionState<TData>>(
      {
        ok: false,
        message: error instanceof Error ? error.message : errorMessage
      },
      { status: 500 }
    );
  }
}
