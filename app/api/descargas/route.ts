import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  actualizarOperacionIngreso,
  crearOperacionIngreso,
  eliminarOperacionIngreso
} from "@/lib/services/operaciones";
import { getModuloOperacionData } from "@/lib/services/operaciones";
import { handleOperacionRequest } from "@/lib/server/operacion-request";
import { serializeModuloOperacionData } from "@/lib/server/module-response";
import {
  createUnauthorizedResponse,
  getRequestActor
} from "@/lib/server/request-auth";
import type {
  CrearOperacionData,
  OperacionMutationData
} from "@/lib/services/operaciones";
import type { ActionState } from "@/types/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getRequestActor(request);

  if (!actor) {
    return createUnauthorizedResponse();
  }

  const data = await getModuloOperacionData("ingreso");
  return NextResponse.json(serializeModuloOperacionData(data));
}

export async function POST(request: Request) {
  const actor = await getRequestActor(request);

  if (!actor) {
    return createUnauthorizedResponse();
  }

  const response = await handleOperacionRequest<CrearOperacionData>({
    request,
    tipoOperacion: "ingreso",
    onCreate: crearOperacionIngreso,
    errorMessage: "No fue posible registrar la descarga.",
    actorUid: actor.uid,
    requireCartaPortePdf: false
  });

  revalidatePath("/");
  revalidatePath("/modulos");

  return response;
}

function getStringValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
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

export async function PATCH(request: Request) {
  const actor = await getRequestActor(request);

  if (!actor) {
    return createUnauthorizedResponse();
  }

  try {
    const formData = await request.formData();
    const operacionId = getStringValue(formData, "operacionId");
    const detalleEnvases = parseDetalleEnvases(formData);
    const result = await actualizarOperacionIngreso(
      operacionId,
      {
        tipoOperacion: "ingreso",
        fechaOperacion: getStringValue(formData, "fechaOperacion"),
        numeroCartaPorte: getStringValue(formData, "numeroCartaPorte"),
        cliente: getStringValue(formData, "cliente"),
        proveedor: getStringValue(formData, "proveedor"),
        proceso: getStringValue(formData, "proceso"),
        procedencia: getStringValue(formData, "procedencia"),
        producto: getStringValue(formData, "producto"),
        kilos: getStringValue(formData, "kilos"),
        cantidadEnvases: getStringValue(formData, "cantidadEnvases"),
        envaseTipoId: getStringValue(formData, "envaseTipoId"),
        envaseEstado: getStringValue(formData, "envaseEstado"),
        detalleEnvases,
        observaciones: getStringValue(formData, "observaciones")
      },
      actor.uid
    );

    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }

    revalidatePath("/");
    revalidatePath("/modulos");

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json<ActionState<OperacionMutationData>>(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "No fue posible actualizar la descarga."
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
    const result = await eliminarOperacionIngreso(body.operacionId ?? "", actor.uid);

    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }

    revalidatePath("/");
    revalidatePath("/modulos");

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json<ActionState<OperacionMutationData>>(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "No fue posible eliminar la descarga."
      },
      { status: 500 }
    );
  }
}
