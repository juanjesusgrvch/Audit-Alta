import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  compactarEspacios,
  construirClavesFecha,
  normalizarTextoParaIndice
} from "@/lib/utils";
import {
  COLLECTIONS,
  operacionCargaPersistenciaSchema,
  type ActionState,
  type EnvaseStock,
  type EnvaseTipo,
  type OperacionCargaPersistenciaInput
} from "@/types/schema";

export type CrearOperacionCargaData = {
  operacionId: string;
  movimientoId: string | null;
};

export async function crearOperacionCarga(
  rawInput: unknown
): Promise<ActionState<CrearOperacionCargaData>> {
  const parsedInput = operacionCargaPersistenciaSchema.safeParse(rawInput);

  if (!parsedInput.success) {
    return {
      ok: false,
      message: "La carga no paso la validacion de dominio.",
      fieldErrors: parsedInput.error.flatten().fieldErrors
    };
  }

  return crearOperacionCargaTransaccional(parsedInput.data);
}

async function crearOperacionCargaTransaccional(
  input: OperacionCargaPersistenciaInput
): Promise<ActionState<CrearOperacionCargaData>> {
  const db = getAdminDb();
  const numeroCartaPorte = compactarEspacios(input.numeroCartaPorte);
  const cliente = compactarEspacios(input.cliente);
  const producto = compactarEspacios(input.producto);
  const observaciones = input.observaciones
    ? compactarEspacios(input.observaciones)
    : null;
  const fechaKeys = construirClavesFecha(input.fechaOperacion);
  const timestampOperacion = Timestamp.fromDate(
    new Date(`${input.fechaOperacion}T00:00:00.000Z`)
  );
  const now = Timestamp.now();
  const numeroCartaPorteNormalizado = normalizarTextoParaIndice(numeroCartaPorte);
  const clienteNormalizado = normalizarTextoParaIndice(cliente);
  const productoNormalizado = normalizarTextoParaIndice(producto);

  const operacionRef = db.collection(COLLECTIONS.operaciones).doc();
  const movimientoRef = db.collection(COLLECTIONS.envaseMovimientos).doc();
  const envaseTipoRef = db.collection(COLLECTIONS.envaseTipos).doc(input.envaseTipoId);
  const stockRef = db.collection(COLLECTIONS.envaseStock).doc(input.envaseTipoId);
  const uniqueKeyRef = db
    .collection(COLLECTIONS.operacionesKeys)
    .doc(`carga__${numeroCartaPorteNormalizado}`);
  const resumenDiarioRef = db
    .collection(COLLECTIONS.dashboardResumenDiario)
    .doc(fechaKeys.fechaKey);

  try {
    let movimientoId: string | null = null;

    await db.runTransaction(async (transaction) => {
      const [envaseTipoSnap, stockSnap, uniqueKeySnap] = await Promise.all([
        transaction.get(envaseTipoRef),
        transaction.get(stockRef),
        transaction.get(uniqueKeyRef)
      ]);

      if (uniqueKeySnap.exists) {
        throw new Error(
          `Ya existe una operacion de carga registrada para la CP ${input.numeroCartaPorte}.`
        );
      }

      if (!envaseTipoSnap.exists) {
        throw new Error("El tipo de envase seleccionado no existe.");
      }

      const envaseTipo = envaseTipoSnap.data() as EnvaseTipo;

      if (envaseTipo.activo === false) {
        throw new Error("El tipo de envase esta inactivo y no puede utilizarse.");
      }

      const controlaStock = envaseTipo.controlaStock !== false;

      if (controlaStock) {
        if (!stockSnap.exists) {
          throw new Error(
            "No existe proyeccion de stock para este tipo de envase. Inicializala antes de operar."
          );
        }

        const stock = stockSnap.data() as EnvaseStock;

        if (stock.stockActual < input.cantidadEnvases) {
          throw new Error(
            `Stock insuficiente para ${envaseTipo.nombre}. Disponible: ${stock.stockActual}, solicitado: ${input.cantidadEnvases}.`
          );
        }
      }

      transaction.create(uniqueKeyRef, {
        operacionId: operacionRef.id,
        tipoOperacion: "carga",
        numeroCartaPorte,
        numeroCartaPorteNormalizado,
        createdAt: now
      });

      transaction.create(operacionRef, {
        tipoOperacion: "carga",
        fechaOperacion: timestampOperacion,
        ...fechaKeys,
        numeroCartaPorte,
        numeroCartaPorteNormalizado,
        cliente,
        clienteNormalizado,
        producto,
        productoNormalizado,
        kilos: input.kilos,
        cantidadEnvases: input.cantidadEnvases,
        envaseTipoId: input.envaseTipoId,
        envaseTipoCodigo: envaseTipo.codigo,
        envaseTipoNombre: envaseTipo.nombre,
        cartaPortePdf: input.cartaPortePdf,
        observaciones,
        createdAt: now,
        updatedAt: now
      });

      if (controlaStock) {
        movimientoId = movimientoRef.id;

        transaction.create(movimientoRef, {
          operacionId: operacionRef.id,
          envaseTipoId: input.envaseTipoId,
          envaseTipoCodigo: envaseTipo.codigo,
          envaseTipoNombre: envaseTipo.nombre,
          tipoMovimiento: "egreso",
          origen: "operacion_carga",
          cantidadEnvases: input.cantidadEnvases,
          deltaEnvases: -input.cantidadEnvases,
          fechaOperacion: timestampOperacion,
          ...fechaKeys,
          cliente,
          clienteNormalizado,
          producto,
          productoNormalizado,
          cartaPorteNumero: numeroCartaPorte,
          observaciones,
          createdAt: now
        });

        transaction.set(
          stockRef,
          {
            envaseTipoId: input.envaseTipoId,
            envaseTipoCodigo: envaseTipo.codigo,
            envaseTipoNombre: envaseTipo.nombre,
            stockActual: FieldValue.increment(-input.cantidadEnvases),
            egresosAcumulados: FieldValue.increment(input.cantidadEnvases),
            updatedAt: now,
            lastMovimientoId: movimientoRef.id,
            version: FieldValue.increment(1)
          },
          { merge: true }
        );
      }

      transaction.set(
        resumenDiarioRef,
        {
          ...fechaKeys,
          totalOperacionesCarga: FieldValue.increment(1),
          totalKilosCarga: FieldValue.increment(input.kilos),
          totalEnvasesCarga: FieldValue.increment(input.cantidadEnvases),
          updatedAt: now
        },
        { merge: true }
      );
    });

    return {
      ok: true,
      message: "La operacion de carga fue registrada de forma atomica.",
      data: {
        operacionId: operacionRef.id,
        movimientoId
      }
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "No fue posible registrar la operacion de carga."
    };
  }
}
