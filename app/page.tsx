import Link from "next/link";
import { getDashboardOverview } from "@/lib/services/dashboard";
import {
  formatearEntero,
  formatearFechaHora,
  formatearKilos
} from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const dashboard = await getDashboardOverview();
  const stockTotal = dashboard.stock.reduce(
    (total, item) => total + item.stockActual,
    0
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-16">
      <section className="rounded-[2rem] border border-slate-200/70 bg-white/85 p-10 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
              Audit Alta
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-slate-950">
              Centro operativo para cargas, movimientos de envases y evidencia documental.
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
              Los modulos ya leen el estado operativo real desde Firestore y exponen
              las integraciones principales de la plataforma.
            </p>
          </div>

          <div className="flex flex-wrap gap-4">
            <Link
              className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
              href="/operaciones/cargas"
            >
              Registrar carga outbound
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Operaciones de hoy"
          value={formatearEntero(dashboard.resumenHoy.totalOperacionesCarga)}
          helper={`Fecha operativa ${dashboard.fechaActual}`}
        />
        <MetricCard
          label="Kg cargados hoy"
          value={formatearKilos(dashboard.resumenHoy.totalKilosCarga)}
          helper="Acumulado diario de despachos"
        />
        <MetricCard
          label="Envases despachados"
          value={formatearEntero(dashboard.resumenHoy.totalEnvasesCarga)}
          helper="Impacto sobre inventario"
        />
        <MetricCard
          label="Stock visible"
          value={formatearEntero(stockTotal)}
          helper={`${dashboard.stock.length} tipos con proyeccion`}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <article className="rounded-[2rem] border border-slate-200/70 bg-white/85 p-8 shadow-sm backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                Stock por envase
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                Inventario operativo visible
              </h2>
            </div>
            <div className="rounded-full bg-slate-100 px-4 py-2 text-sm text-slate-600">
              {dashboard.envaseTiposActivos.length} tipos activos
            </div>
          </div>

          {dashboard.firestoreDisponible && dashboard.stock.length > 0 ? (
            <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Envase</th>
                    <th className="px-4 py-3 font-medium">Stock</th>
                    <th className="px-4 py-3 font-medium">Egresos</th>
                    <th className="px-4 py-3 font-medium">Ult. actualizacion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {dashboard.stock.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-3 text-slate-700">
                        <div className="font-medium text-slate-950">
                          {item.envaseTipoNombre}
                        </div>
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
                          {item.envaseTipoCodigo}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-950">
                        {formatearEntero(item.stockActual)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatearEntero(item.egresosAcumulados)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatearFechaHora(item.updatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Sin stock visible"
              description="No se pudo leer Firestore o todavia no existen documentos en envase_stock."
            />
          )}
        </article>

        <div className="grid gap-6">
          <article className="rounded-[2rem] border border-slate-200/70 bg-white/85 p-8 shadow-sm backdrop-blur">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              Integraciones
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              Estado de infraestructura
            </h2>

            <div className="mt-6 grid gap-3">
              <IntegrationRow
                label="Firestore Admin"
                ok={dashboard.firestoreDisponible}
                detail={
                  dashboard.firestoreDisponible
                    ? "Conexion operativa para lecturas server-side."
                    : "No se pudo consultar Firestore con las credenciales actuales."
                }
              />
              <IntegrationRow
                label="Storage bucket"
                ok={dashboard.storageConfigurado}
                detail={
                  dashboard.storageConfigurado
                    ? "Bucket configurado para cartas de porte y rollback."
                    : "Falta configurar el bucket de Firebase Storage."
                }
              />
              <IntegrationRow
                label="Catalogo de envases"
                ok={dashboard.envaseTiposActivos.length > 0}
                detail={
                  dashboard.envaseTiposActivos.length > 0
                    ? `${dashboard.envaseTiposActivos.length} tipos activos listos para operar.`
                    : "No hay tipos de envase activos disponibles."
                }
              />
            </div>
          </article>

          <article className="rounded-[2rem] border border-slate-200/70 bg-white/85 p-8 shadow-sm backdrop-blur">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              Tipos habilitados
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              Modulos listos para operar
            </h2>

            {dashboard.envaseTiposActivos.length > 0 ? (
              <div className="mt-6 flex flex-wrap gap-3">
                {dashboard.envaseTiposActivos.map((item) => (
                  <span
                    key={item.id}
                    className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700"
                  >
                    {item.nombre}
                  </span>
                ))}
              </div>
            ) : (
              <EmptyState
                title="Sin tipos activos"
                description="Carga datos semilla en envase_tipos para habilitar formularios y dashboard."
              />
            )}
          </article>
        </div>
      </section>

      <article className="rounded-[2rem] border border-slate-200/70 bg-white/85 p-8 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              Operaciones recientes
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              Ultimos registros consolidados
            </h2>
          </div>
          <span className="rounded-full bg-slate-100 px-4 py-2 text-sm text-slate-600">
            {dashboard.operacionesRecientes.length} items
          </span>
        </div>

        {dashboard.firestoreDisponible && dashboard.operacionesRecientes.length > 0 ? (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {dashboard.operacionesRecientes.map((operacion) => (
              <div
                key={operacion.id}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">
                      {operacion.cliente}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {operacion.producto}
                    </p>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500">
                    CP {operacion.numeroCartaPorte}
                  </span>
                </div>

                <dl className="mt-4 grid gap-2 text-sm text-slate-600">
                  <div className="flex items-center justify-between gap-4">
                    <dt>Envase</dt>
                    <dd className="font-medium text-slate-950">
                      {operacion.envaseTipoNombre}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt>Envases</dt>
                    <dd className="font-medium text-slate-950">
                      {formatearEntero(operacion.cantidadEnvases)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt>Kilos</dt>
                    <dd className="font-medium text-slate-950">
                      {formatearKilos(operacion.kilos)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt>Registrada</dt>
                    <dd className="font-medium text-slate-950">
                      {formatearFechaHora(operacion.createdAt)}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Sin operaciones recientes"
            description="Cuando se registren cargas, este modulo mostrara la trazabilidad consolidada."
          />
        )}
      </article>
    </main>
  );
}

type MetricCardProps = {
  label: string;
  value: string;
  helper: string;
};

function MetricCard({ label, value, helper }: MetricCardProps) {
  return (
    <article className="rounded-[1.75rem] border border-slate-200/70 bg-white/85 p-6 shadow-sm backdrop-blur">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
        {value}
      </p>
      <p className="mt-2 text-sm text-slate-600">{helper}</p>
    </article>
  );
}

type IntegrationRowProps = {
  label: string;
  ok: boolean;
  detail: string;
};

function IntegrationRow({ label, ok, detail }: IntegrationRowProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
      <div className="flex items-center justify-between gap-4">
        <p className="font-medium text-slate-950">{label}</p>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            ok
              ? "bg-emerald-100 text-emerald-700"
              : "bg-amber-100 text-amber-700"
          }`}
        >
          {ok ? "OK" : "Pendiente"}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-600">{detail}</p>
    </div>
  );
}

type EmptyStateProps = {
  title: string;
  description: string;
};

function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6">
      <p className="font-medium text-slate-950">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
    </div>
  );
}
