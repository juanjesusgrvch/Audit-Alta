import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { serializeProcesosModuleData } from "@/lib/server/module-response";
import {
  createUnauthorizedResponse,
  getRequestActor
} from "@/lib/server/request-auth";
import {
  actualizarProceso,
  crearProceso,
  eliminarSalidaProceso,
  eliminarProceso,
  getProcesosModuleData,
  reprocesarSalidaProceso,
  type CrearProcesoData,
  type ProcesoMutationData
} from "@/lib/services/procesos";
import type { ActionState } from "@/types/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getStringValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function GET(request: Request) {
  const actor = await getRequestActor(request);

  if (!actor) {
    return createUnauthorizedResponse();
  }

  const data = await getProcesosModuleData();
  return NextResponse.json(serializeProcesosModuleData(data));
}

export async function POST(request: Request) {
  const actor = await getRequestActor(request);

  if (!actor) {
    return createUnauthorizedResponse();
  }

  try {
    const formData = await request.formData();
    const salidasRaw = getStringValue(formData, "salidas");
    const result = await crearProceso(
      {
        fechaProceso: getStringValue(formData, "fechaProceso"),
        cliente: getStringValue(formData, "cliente"),
        proceso: getStringValue(formData, "proceso"),
        procedencia: getStringValue(formData, "procedencia"),
        producto: getStringValue(formData, "producto"),
        tipoOrden: getStringValue(formData, "tipoOrden"),
        salidas: salidasRaw ? JSON.parse(salidasRaw) : [],
        observaciones: getStringValue(formData, "observaciones"),
      },
      actor.uid
    );

    if (!result.ok) {
      return NextResponse.json<ActionState<CrearProcesoData>>(result, {
        status: 400
      });
    }

    revalidatePath("/");
    revalidatePath("/modulos");

    return NextResponse.json<ActionState<CrearProcesoData>>(result);
  } catch (error) {
    return NextResponse.json<ActionState<CrearProcesoData>>(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "No fue posible registrar el proceso."
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const actor = await getRequestActor(request);

  if (!actor) {
    return createUnauthorizedResponse();
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const accion =
      typeof body.accion === "string" ? body.accion : "actualizar";
    const procesoId = typeof body.procesoId === "string" ? body.procesoId : "";

    const result =
      accion === "reprocesar_salida"
        ? await reprocesarSalidaProceso(
            procesoId,
            typeof body.salidaId === "string" ? body.salidaId : "",
            actor.uid
          )
        : accion === "eliminar_salida"
          ? await eliminarSalidaProceso(
              procesoId,
              typeof body.salidaId === "string" ? body.salidaId : "",
              actor.uid
            )
          : await actualizarProceso(
              procesoId,
              {
                fechaProceso:
                  typeof body.fechaProceso === "string" ? body.fechaProceso : "",
                cliente: typeof body.cliente === "string" ? body.cliente : "",
                proceso: typeof body.proceso === "string" ? body.proceso : "",
                procedencia:
                  typeof body.procedencia === "string" ? body.procedencia : "",
                producto: typeof body.producto === "string" ? body.producto : "",
                tipoOrden:
                  typeof body.tipoOrden === "string" ? body.tipoOrden : "",
                salidas: Array.isArray(body.salidas) ? body.salidas : [],
                observaciones:
                  typeof body.observaciones === "string"
                    ? body.observaciones
                    : ""
              },
              actor.uid
            );

    if (!result.ok) {
      return NextResponse.json<ActionState<ProcesoMutationData>>(result, {
        status: 400
      });
    }

    revalidatePath("/");
    revalidatePath("/modulos");

    return NextResponse.json<ActionState<ProcesoMutationData>>(result);
  } catch (error) {
    return NextResponse.json<ActionState<ProcesoMutationData>>(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "No fue posible actualizar el proceso."
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
    const body = (await request.json()) as Record<string, unknown>;
    const result = await eliminarProceso(
      typeof body.procesoId === "string" ? body.procesoId : ""
    );

    if (!result.ok) {
      return NextResponse.json<ActionState<ProcesoMutationData>>(result, {
        status: 400
      });
    }

    revalidatePath("/");
    revalidatePath("/modulos");

    return NextResponse.json<ActionState<ProcesoMutationData>>(result);
  } catch (error) {
    return NextResponse.json<ActionState<ProcesoMutationData>>(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "No fue posible eliminar el proceso."
      },
      { status: 500 }
    );
  }
}
