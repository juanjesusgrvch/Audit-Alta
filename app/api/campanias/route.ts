import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  getCampaniasPeriodo,
  guardarCampaniasPeriodo,
  type GuardarCampaniasData
} from "@/lib/services/campanias";
import {
  createUnauthorizedResponse,
  getRequestActor
} from "@/lib/server/request-auth";
import type { ActionState } from "@/types/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getRequestActor(request);

  if (!actor) {
    return createUnauthorizedResponse();
  }

  const campanias = await getCampaniasPeriodo();
  return NextResponse.json({ campanias });
}

export async function PUT(request: Request) {
  const actor = await getRequestActor(request);

  if (!actor) {
    return createUnauthorizedResponse();
  }

  try {
    const payload = await request.json();
    const result = await guardarCampaniasPeriodo(payload, actor.uid);

    if (!result.ok) {
      return NextResponse.json<ActionState<GuardarCampaniasData>>(result, {
        status: 400
      });
    }

    revalidatePath("/");
    revalidatePath("/modulos");

    return NextResponse.json<ActionState<GuardarCampaniasData>>(result);
  } catch (error) {
    return NextResponse.json<ActionState<GuardarCampaniasData>>(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "No fue posible guardar los periodos de campaña."
      },
      { status: 500 }
    );
  }
}
