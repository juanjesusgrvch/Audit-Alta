import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  actualizarOperacionEgreso,
  crearOperacionEgreso,
  eliminarOperacionEgreso,
  getModuloOperacionData
} from "@/lib/services/operaciones";
import { handleOperacionRequest } from "@/lib/server/operacion-request";
import { serializeModuloOperacionData } from "@/lib/server/module-response";
import {
  createUnauthorizedResponse,
  getRequestActor
} from "@/lib/server/request-auth";
import {
  eliminarCartaDePorte,
  subirCartaDePortePdf
} from "@/lib/services/storage";
import type {
  CrearOperacionData,
  OperacionMutationData
} from "@/lib/services/operaciones";
import type { ActionState } from "@/types/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getStringValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function getFileValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File ? value : null;
}

function getBooleanValue(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string") {
    return false;
  }

  return value.trim().toLowerCase() === "true";
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

export async function GET(request: Request) {
  const actor = await getRequestActor(request);

  if (!actor) {
    return createUnauthorizedResponse();
  }

  const data = await getModuloOperacionData("egreso");
  return NextResponse.json(serializeModuloOperacionData(data));
}

export async function POST(request: Request) {
  const actor = await getRequestActor(request);

  if (!actor) {
    return createUnauthorizedResponse();
  }

  const response = await handleOperacionRequest<CrearOperacionData>({
    request,
    tipoOperacion: "egreso",
    onCreate: crearOperacionEgreso,
    errorMessage: "No fue posible registrar la carga.",
    actorUid: actor.uid,
    requireCartaPortePdf: false
  });

  revalidatePath("/");
  revalidatePath("/modulos");

  return response;
}

export async function PATCH(request: Request) {
  const actor = await getRequestActor(request);

  if (!actor) {
    return createUnauthorizedResponse();
  }

  let uploadedStoragePath: string | null = null;

  try {
    const formData = await request.formData();
    const detalleEnvases = parseDetalleEnvases(formData);
    const loteEnvasadoDetalles = parseJsonArrayField(
      formData,
      "loteEnvasadoDetalles"
    );
    const file = getFileValue(formData, "cartaPortePdf");
    const cartaPortePdf = file
      ? await subirCartaDePortePdf({
          file,
          numeroCartaPorte: getStringValue(formData, "numeroCartaPorte"),
          fechaOperacion: getStringValue(formData, "fechaOperacion")
        })
      : undefined;

    if (cartaPortePdf) {
      uploadedStoragePath = cartaPortePdf.storagePath;
    }

    const result = await actualizarOperacionEgreso(
      getStringValue(formData, "operacionId"),
      {
        tipoOperacion: "egreso",
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
        envaseMode: getStringValue(formData, "envaseMode"),
        confirmarStockInsuficiente: getBooleanValue(
          formData,
          "confirmarStockInsuficiente",
        ),
        detalleEnvases,
        loteEnvasadoDetalles,
        cartaPortePdf,
        observaciones: getStringValue(formData, "observaciones")
      },
      actor.uid
    );

    if (!result.ok) {
      if (uploadedStoragePath) {
        await eliminarCartaDePorte(uploadedStoragePath).catch(() => undefined);
      }

      return NextResponse.json<ActionState<OperacionMutationData>>(result, {
        status: 400
      });
    }

    revalidatePath("/");
    revalidatePath("/modulos");

    return NextResponse.json<ActionState<OperacionMutationData>>(result);
  } catch (error) {
    if (uploadedStoragePath) {
      await eliminarCartaDePorte(uploadedStoragePath).catch(() => undefined);
    }

    return NextResponse.json<ActionState<OperacionMutationData>>(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "No fue posible actualizar la carga."
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const actor = await getRequestActor(request);

  if (!actor) {
    return createUnauthorizedResponse();
  }

  try {
    const body = (await request.json()) as { operacionId?: string };
    const result = await eliminarOperacionEgreso(body.operacionId ?? "", actor.uid);

    if (!result.ok) {
      return NextResponse.json<ActionState<OperacionMutationData>>(result, {
        status: 400
      });
    }

    revalidatePath("/");
    revalidatePath("/modulos");

    return NextResponse.json<ActionState<OperacionMutationData>>(result);
  } catch (error) {
    return NextResponse.json<ActionState<OperacionMutationData>>(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "No fue posible eliminar la carga."
      },
      { status: 500 }
    );
  }
}
