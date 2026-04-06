import "server-only";

import { randomUUID } from "node:crypto";
import { getAdminStorage, getFirebaseStorageBucketName } from "@/lib/firebase/admin";
import {
  compactarEspacios,
  quitarExtensionArchivo,
  sanearSegmentoArchivo
} from "@/lib/utils";
import type { CartaPorteArchivo } from "@/types/schema";

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const PDF_CONTENT_TYPE = "application/pdf";
const PDF_SIGNATURE = Buffer.from("%PDF-");

type CartaPorteUploadParams = {
  file: File;
  numeroCartaPorte: string;
  fechaOperacion: string;
};

function validarCartaDePorte(file: File) {
  if (file.type !== PDF_CONTENT_TYPE) {
    throw new Error("La Carta de Porte debe subirse en formato PDF.");
  }

  if (file.size <= 0) {
    throw new Error("El archivo PDF no contiene datos.");
  }

  if (file.size > MAX_PDF_BYTES) {
    throw new Error("El PDF excede el limite permitido de 10 MB.");
  }
}

async function leerBufferCartaDePorte(file: File) {
  validarCartaDePorte(file);

  const buffer = Buffer.from(await file.arrayBuffer());

  if (buffer.length < PDF_SIGNATURE.length) {
    throw new Error("El archivo PDF no es valido.");
  }

  if (!buffer.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)) {
    throw new Error("El archivo subido no contiene una firma PDF valida.");
  }

  return buffer;
}

function construirDownloadUrl(storagePath: string, token: string) {
  const bucketName = getFirebaseStorageBucketName();
  const encodedPath = encodeURIComponent(storagePath);

  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${token}`;
}

export async function subirCartaDePortePdf({
  file,
  numeroCartaPorte,
  fechaOperacion
}: CartaPorteUploadParams): Promise<CartaPorteArchivo> {
  const numeroCartaPorteNormalizado = compactarEspacios(numeroCartaPorte);

  const yearMonth = fechaOperacion.slice(0, 7);
  const cpSegment = sanearSegmentoArchivo(numeroCartaPorteNormalizado, "cp");
  const originalName = sanearSegmentoArchivo(
    quitarExtensionArchivo(file.name || "carta-porte"),
    "carta-porte"
  );
  const token = randomUUID();
  const fileName = `${cpSegment}-${originalName}-${randomUUID()}.pdf`;
  const storagePath = `cartas_de_porte/${yearMonth}/${fileName}`;
  const bucket = getAdminStorage().bucket();
  const buffer = await leerBufferCartaDePorte(file);

  await bucket.file(storagePath).save(buffer, {
    contentType: PDF_CONTENT_TYPE,
    resumable: false,
    metadata: {
      metadata: {
        cartaPorteNumero: numeroCartaPorteNormalizado,
        fechaOperacion,
        firebaseStorageDownloadTokens: token
      }
    }
  });

  return {
    storagePath,
    downloadUrl: construirDownloadUrl(storagePath, token),
    fileName,
    contentType: PDF_CONTENT_TYPE,
    sizeBytes: file.size
  };
}

export async function eliminarCartaDePorte(storagePath: string) {
  if (!storagePath) {
    return;
  }

  await getAdminStorage().bucket().file(storagePath).delete({
    ignoreNotFound: true
  });
}
