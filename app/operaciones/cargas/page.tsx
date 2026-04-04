import { FormularioOperacion } from "@/app/components/FormularioOperacion";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, type EnvaseTipo } from "@/types/schema";

export const dynamic = "force-dynamic";

type EnvaseTipoOption = Pick<
  EnvaseTipo,
  "codigo" | "nombre" | "descripcion" | "controlaStock" | "activo" | "orden"
> & {
  id: string;
};

async function getEnvaseTiposActivos(): Promise<EnvaseTipoOption[]> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(COLLECTIONS.envaseTipos)
    .where("activo", "==", true)
    .orderBy("orden", "asc")
    .get();

  return snapshot.docs.map((documento) => {
    const data = documento.data() as EnvaseTipo;

    return {
      id: documento.id,
      codigo: data.codigo,
      nombre: data.nombre,
      descripcion: data.descripcion,
      controlaStock: data.controlaStock !== false,
      activo: data.activo !== false,
      orden: data.orden ?? 0
    };
  });
}

export default async function OperacionesCargaPage() {
  let envaseTipos: EnvaseTipoOption[] = [];
  let infraestructuraOk = true;

  try {
    envaseTipos = await getEnvaseTiposActivos();
  } catch {
    infraestructuraOk = false;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <section className="rounded-3xl border border-slate-200/70 bg-white/85 p-8 shadow-sm backdrop-blur">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
          Operaciones outbound
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
          Registrar carga y descontar stock de envases en una unica transaccion
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          El formulario persiste la operacion, genera el movimiento del libro
          mayor y actualiza la proyeccion de stock por tipo de envase.
        </p>
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <InfoChip
            label="Tipos activos"
            value={String(envaseTipos.length)}
          />
          <InfoChip
            label="Upload PDF"
            value="Server-side"
          />
          <InfoChip
            label="Persistencia"
            value="Con rollback"
          />
        </div>
      </section>

      {!infraestructuraOk ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          No se pudo leer Firestore. Verifica las credenciales de Firebase Admin
          y la coleccion <code>envase_tipos</code>.
        </section>
      ) : null}

      <FormularioOperacion envaseTipos={envaseTipos} />
    </main>
  );
}

type InfoChipProps = {
  label: string;
  value: string;
};

function InfoChip({ label, value }: InfoChipProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs uppercase tracking-[0.16em] text-slate-400">{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}
