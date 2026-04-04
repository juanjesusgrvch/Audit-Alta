import "server-only";

import { randomUUID } from "node:crypto";
import { getAdminStorage, getFirebaseStorageBucketName } from "@/lib/firebase/admin";
import { quitarExtensionArchivo, sanearSegmentoArchivo } from "@/lib/utils";
import type { CartaPorteArchivo } from "@/types/schema";

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const PDF_CONTENT_TYPE = "application/pdf";

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
  validarCartaDePorte(file);

  const yearMonth = fechaOperacion.slice(0, 7);
  const cpSegment = sanearSegmentoArchivo(numeroCartaPorte, "cp");
  const originalName = sanearSegmentoArchivo(
    quitarExtensionArchivo(file.name || "carta-porte"),
    "carta-porte"
  );
  const token = randomUUID();
  const fileName = `${cpSegment}-${originalName}-${randomUUID()}.pdf`;
  const storagePath = `cartas_de_porte/${yearMonth}/${fileName}`;
  const bucket = getAdminStorage().bucket();
  const buffer = Buffer.from(await file.arrayBuffer());

  await bucket.file(storagePath).save(buffer, {
    contentType: PDF_CONTENT_TYPE,
    resumable: false,
    metadata: {
      metadata: {
        cartaPorteNumero: numeroCartaPorte,
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
