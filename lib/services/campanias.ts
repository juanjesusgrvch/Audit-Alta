import "server-only";

import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { compactarEspacios, construirEnvaseTipoIdManual } from "@/lib/utils";
import {
  COLLECTIONS,
  campaniaPeriodoSchema,
  campaniaPeriodosPayloadSchema,
  type ActionState
} from "@/types/schema";

const DEFAULT_FIRESTORE_ACTOR =
  process.env.FIRESTORE_DEFAULT_ACTOR?.trim() || "audit-alta-system";

export type CampaniaPeriodo = {
  id: string;
  nombre: string;
  fechaDesde: string;
  fechaHasta: string;
  predeterminada: boolean;
};

export type GuardarCampaniasData = {
  cantidad: number;
};

function parseCampaniaPeriodo(
  id: string,
  data: FirebaseFirestore.DocumentData
): CampaniaPeriodo | null {
  const parsed = campaniaPeriodoSchema.safeParse({
    id,
    nombre: data.nombre,
    fechaDesde: data.fechaDesde,
    fechaHasta: data.fechaHasta,
    predeterminada: data.predeterminada
  });

  return parsed.success ? parsed.data : null;
}

function buildCampaniaId(nombre: string) {
  return construirEnvaseTipoIdManual(`campania-${nombre}`).replace(
    /^manual-/,
    "campania-"
  );
}

export async function getCampaniasPeriodo(): Promise<CampaniaPeriodo[]> {
  try {
    const db = getAdminDb();
    const snapshot = await db
      .collection(COLLECTIONS.campanias)
      .orderBy("fechaDesde", "desc")
      .get();

    return snapshot.docs
      .flatMap((documento) => {
        const parsed = parseCampaniaPeriodo(documento.id, documento.data());
        return parsed ? [parsed] : [];
      })
      .sort((a, b) => b.fechaDesde.localeCompare(a.fechaDesde, "es"));
  } catch {
    return [];
  }
}

export async function guardarCampaniasPeriodo(
  rawInput: unknown,
  actorUid?: string
): Promise<ActionState<GuardarCampaniasData>> {
  const parsed = campaniaPeriodosPayloadSchema.safeParse(rawInput);

  if (!parsed.success) {
    return {
      ok: false,
      message: "Los periodos de campaña no pasaron la validacion.",
      fieldErrors: parsed.error.flatten().fieldErrors
    };
  }

  const actorId = actorUid?.trim() || DEFAULT_FIRESTORE_ACTOR;
  const db = getAdminDb();
  const now = Timestamp.now();
  const normalizedCampaigns = parsed.data.campanias
    .map((campania) => ({
      id: compactarEspacios(campania.id) || buildCampaniaId(campania.nombre),
      nombre: compactarEspacios(campania.nombre),
      fechaDesde: campania.fechaDesde,
      fechaHasta: campania.fechaHasta,
      predeterminada: campania.predeterminada === true
    }))
    .sort((a, b) => b.fechaDesde.localeCompare(a.fechaDesde, "es"));
  const defaultCampaignId =
    normalizedCampaigns.find((campania) => campania.predeterminada)?.id ?? null;

  try {
    const existingSnapshot = await db.collection(COLLECTIONS.campanias).get();
    const nextIds = new Set(normalizedCampaigns.map((campania) => campania.id));
    const batch = db.batch();

    for (const documento of existingSnapshot.docs) {
      if (!nextIds.has(documento.id)) {
        batch.delete(documento.ref);
      }
    }

    for (const campania of normalizedCampaigns) {
      const reference = db.collection(COLLECTIONS.campanias).doc(campania.id);
      const existingDoc = existingSnapshot.docs.find(
        (documento) => documento.id === campania.id
      );

      batch.set(
        reference,
        {
          nombre: campania.nombre,
          fechaDesde: campania.fechaDesde,
          fechaHasta: campania.fechaHasta,
          predeterminada:
            defaultCampaignId !== null && campania.id === defaultCampaignId,
          createdAt: existingDoc?.get("createdAt") ?? now,
          createdBy: existingDoc?.get("createdBy") ?? actorId,
          updatedAt: now,
          updatedBy: actorId
        },
        { merge: true }
      );
    }

    await batch.commit();

    return {
      ok: true,
      message: "Los periodos de campaña fueron actualizados.",
      data: {
        cantidad: normalizedCampaigns.length
      }
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "No fue posible guardar los periodos de campaña."
    };
  }
}
