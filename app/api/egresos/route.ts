import { revalidatePath } from "next/cache";
import { crearOperacionEgreso } from "@/lib/services/operaciones";
import { handleOperacionRequest } from "@/lib/server/operacion-request";
import {
  createUnauthorizedResponse,
  getRequestActor
} from "@/lib/server/request-auth";
import type { CrearOperacionData } from "@/lib/services/operaciones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    actorUid: actor.uid
  });

  revalidatePath("/");
  revalidatePath("/modulos");

  return response;
}
