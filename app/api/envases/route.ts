import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  actualizarBajaManualEnvase,
  actualizarIngresoManualEnvase,
  crearBajaManualEnvase,
  crearIngresoManualEnvase,
  eliminarMovimientoManualEnvase,
  getEnvasesDashboardData,
  ocultarLoteAgotadoEnvase,
  type OcultarLoteEnvaseData,
  type CrearMovimientoEnvaseData
} from "@/lib/services/envases-module";
import {
  serializeEnvasesDashboardData
} from "@/lib/server/module-response";
import {
  createUnauthorizedResponse,
  getRequestActor
} from "@/lib/server/request-auth";
import { crearEnvase } from "@/lib/services/operaciones";
import type { ActionState } from "@/types/schema";
import type { CrearEnvaseData } from "@/lib/services/operaciones";

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

  const data = await getEnvasesDashboardData();
  return NextResponse.json(serializeEnvasesDashboardData(data));
}

export async function POST(request: Request) {
  const actor = await getRequestActor(request);

  if (!actor) {
    return createUnauthorizedResponse();
  }

  try {
    const formData = await request.formData();
    const accion = getStringValue(formData, "accion") || "crear_envase";
    let result:
      | ActionState<CrearEnvaseData>
      | ActionState<CrearMovimientoEnvaseData>;

    if (accion === "ingreso_manual") {
      result = await crearIngresoManualEnvase({
        fechaMovimiento: getStringValue(formData, "fechaMovimiento"),
        cliente: getStringValue(formData, "cliente"),
        envaseTipoId: getStringValue(formData, "envaseTipoId"),
        envaseTipoNombre: getStringValue(formData, "envaseTipoNombre"),
        envaseEstado: getStringValue(formData, "envaseEstado"),
        kilos: getStringValue(formData, "kilos"),
        cantidad: getStringValue(formData, "cantidad"),
        transporte: getStringValue(formData, "transporte"),
        observaciones: getStringValue(formData, "observaciones")
      }, actor.uid);
    } else if (accion === "baja_manual") {
      result = await crearBajaManualEnvase({
        fechaMovimiento: getStringValue(formData, "fechaMovimiento"),
        cliente: getStringValue(formData, "cliente"),
        tipoSalida: getStringValue(formData, "tipoSalida"),
        kilos: getStringValue(formData, "kilos"),
        inventoryId: getStringValue(formData, "inventoryId"),
        sourceId: getStringValue(formData, "sourceId"),
        envaseTipoId: getStringValue(formData, "envaseTipoId"),
        envaseEstado: getStringValue(formData, "envaseEstado"),
        cantidad: getStringValue(formData, "cantidad"),
        causa: getStringValue(formData, "causa"),
        observaciones: getStringValue(formData, "observaciones")
      }, actor.uid);
    } else {
      result = await crearEnvase({
        codigo: getStringValue(formData, "codigo"),
        nombre: getStringValue(formData, "nombre"),
        descripcion: getStringValue(formData, "descripcion"),
        controlaStock: formData.get("controlaStock") === "on",
        stockActual: getStringValue(formData, "stockActual"),
        orden: getStringValue(formData, "orden")
      }, actor.uid);
    }

    if (!result.ok) {
      return NextResponse.json(result, {
        status: 400
      });
    }

    revalidatePath("/");
    revalidatePath("/modulos");

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json<ActionState<CrearMovimientoEnvaseData | CrearEnvaseData>>(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "No fue posible crear el envase."
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
    const accion = typeof body.accion === "string" ? body.accion : "";
    let result:
      | ActionState<CrearMovimientoEnvaseData>
      | ActionState<OcultarLoteEnvaseData>;

    if (accion === "editar_ingreso_manual") {
      result = await actualizarIngresoManualEnvase(
        typeof body.movimientoId === "string" ? body.movimientoId : "",
        {
          fechaMovimiento:
            typeof body.fechaMovimiento === "string" ? body.fechaMovimiento : "",
          cliente: typeof body.cliente === "string" ? body.cliente : "",
          envaseTipoId:
            typeof body.envaseTipoId === "string" ? body.envaseTipoId : "",
          envaseTipoNombre:
            typeof body.envaseTipoNombre === "string"
              ? body.envaseTipoNombre
              : "",
          envaseEstado:
            typeof body.envaseEstado === "string" ? body.envaseEstado : "",
          kilos: body.kilos,
          cantidad: body.cantidad,
          transporte: typeof body.transporte === "string" ? body.transporte : "",
          observaciones:
            typeof body.observaciones === "string" ? body.observaciones : ""
        },
        actor.uid
      );
    } else if (accion === "editar_baja_manual") {
      result = await actualizarBajaManualEnvase(
        typeof body.movimientoId === "string" ? body.movimientoId : "",
        {
          fechaMovimiento:
            typeof body.fechaMovimiento === "string" ? body.fechaMovimiento : "",
          cliente: typeof body.cliente === "string" ? body.cliente : "",
          tipoSalida:
            typeof body.tipoSalida === "string" ? body.tipoSalida : "baja",
          kilos: body.kilos,
          inventoryId:
            typeof body.inventoryId === "string" ? body.inventoryId : "",
          sourceId:
            typeof body.sourceId === "string" ? body.sourceId : "",
          envaseTipoId:
            typeof body.envaseTipoId === "string" ? body.envaseTipoId : "",
          envaseEstado:
            typeof body.envaseEstado === "string" ? body.envaseEstado : "",
          cantidad: body.cantidad,
          causa: typeof body.causa === "string" ? body.causa : "",
          observaciones:
            typeof body.observaciones === "string" ? body.observaciones : ""
        },
        actor.uid
      );
    } else if (accion === "ocultar_lote_agotado") {
      result = await ocultarLoteAgotadoEnvase(
        {
          inventoryId:
            typeof body.inventoryId === "string" ? body.inventoryId : "",
          cliente: typeof body.cliente === "string" ? body.cliente : ""
        },
        actor.uid
      );
    } else {
      return NextResponse.json(
        {
          ok: false,
          message: "La accion solicitada no existe."
        },
        { status: 400 }
      );
    }

    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }

    revalidatePath("/");
    revalidatePath("/modulos");

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json<
      ActionState<CrearMovimientoEnvaseData | OcultarLoteEnvaseData>
    >(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "No fue posible actualizar el movimiento manual."
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
    const result = await eliminarMovimientoManualEnvase(
      typeof body.movimientoId === "string" ? body.movimientoId : "",
      actor.uid
    );

    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }

    revalidatePath("/");
    revalidatePath("/modulos");

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json<ActionState<CrearMovimientoEnvaseData>>(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "No fue posible eliminar el movimiento manual."
      },
      { status: 500 }
    );
  }
}
