import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { crearOperacionCarga } from "@/lib/services/operaciones";
import { eliminarCartaDePorte, subirCartaDePortePdf } from "@/lib/services/storage";
import {
  operacionCargaFormSchema,
  type ActionState
} from "@/types/schema";
import type { CrearOperacionCargaData } from "@/lib/services/operaciones";

export const runtime = "nodejs";

function getStringValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function getFileValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File ? value : null;
}

export async function POST(request: Request) {
  let uploadedStoragePath: string | null = null;

  try {
    const formData = await request.formData();
    const parsedFields = operacionCargaFormSchema.safeParse({
      tipoOperacion: getStringValue(formData, "tipoOperacion"),
      fechaOperacion: getStringValue(formData, "fechaOperacion"),
      numeroCartaPorte: getStringValue(formData, "numeroCartaPorte"),
      cliente: getStringValue(formData, "cliente"),
      producto: getStringValue(formData, "producto"),
      kilos: getStringValue(formData, "kilos"),
      cantidadEnvases: getStringValue(formData, "cantidadEnvases"),
      envaseTipoId: getStringValue(formData, "envaseTipoId"),
      observaciones: getStringValue(formData, "observaciones")
    });

    if (!parsedFields.success) {
      return NextResponse.json<ActionState<CrearOperacionCargaData>>(
        {
          ok: false,
          message: "La carga no paso la validacion del formulario.",
          fieldErrors: parsedFields.error.flatten().fieldErrors
        },
        { status: 400 }
      );
    }

    const file = getFileValue(formData, "cartaPortePdf");

    if (!file) {
      return NextResponse.json<ActionState<CrearOperacionCargaData>>(
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

    const cartaPortePdf = await subirCartaDePortePdf({
      file,
      numeroCartaPorte: parsedFields.data.numeroCartaPorte,
      fechaOperacion: parsedFields.data.fechaOperacion
    });

    uploadedStoragePath = cartaPortePdf.storagePath;

    const result = await crearOperacionCarga({
      ...parsedFields.data,
      cartaPortePdf
    });

    if (!result.ok) {
      await eliminarCartaDePorte(cartaPortePdf.storagePath);

      return NextResponse.json(result, { status: 400 });
    }

    revalidatePath("/");
    revalidatePath("/operaciones/cargas");

    return NextResponse.json(result);
  } catch (error) {
    if (uploadedStoragePath) {
      await eliminarCartaDePorte(uploadedStoragePath).catch(() => undefined);
    }

    return NextResponse.json<ActionState<CrearOperacionCargaData>>(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "No fue posible registrar la operacion de carga."
      },
      { status: 500 }
    );
  }
}
