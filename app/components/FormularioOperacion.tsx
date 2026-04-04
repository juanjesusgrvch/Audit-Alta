"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { CrearOperacionCargaData } from "@/lib/services/operaciones";
import {
  envaseTipoSchema,
  operacionCargaFormSchema,
  type ActionState,
  type EnvaseTipo,
  type OperacionCargaFormInput
} from "@/types/schema";

type EnvaseTipoOption = Pick<
  EnvaseTipo,
  "codigo" | "nombre" | "descripcion" | "controlaStock" | "activo" | "orden"
> & {
  id: string;
};

type FormularioOperacionProps = {
  envaseTipos: EnvaseTipoOption[];
};

function getTodayLocalInputValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function formatFileSize(sizeBytes: number) {
  return new Intl.NumberFormat("es-AR", {
    maximumFractionDigits: 1
  }).format(sizeBytes / 1024 / 1024);
}

export function FormularioOperacion({
  envaseTipos
}: FormularioOperacionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  const options = envaseTipos.flatMap((envaseTipo) => {
    const parsed = envaseTipoSchema.safeParse(envaseTipo);

    if (!parsed.success) {
      return [];
    }

    return [
      {
        ...parsed.data,
        id: envaseTipo.id
      }
    ];
  });

  const form = useForm<OperacionCargaFormInput>({
    resolver: zodResolver(operacionCargaFormSchema),
    defaultValues: {
      tipoOperacion: "carga",
      fechaOperacion: getTodayLocalInputValue(),
      numeroCartaPorte: "",
      cliente: "",
      producto: "",
      kilos: 0,
      cantidadEnvases: 0,
      envaseTipoId: options[0]?.id ?? "",
      observaciones: ""
    }
  });

  const selectedEnvaseTipo = options.find(
    (envaseTipo) => envaseTipo.id === form.watch("envaseTipoId")
  );

  const handleSubmit = form.handleSubmit((values) => {
    setServerMessage(null);
    setServerError(null);
    form.clearErrors();

    if (!pdfFile) {
      const message = "La Carta de Porte en PDF es obligatoria.";
      setServerError(message);
      form.setError("root.serverError", {
        type: "manual",
        message
      });
      return;
    }

    startTransition(async () => {
      try {
        const requestBody = new FormData();

        requestBody.set("tipoOperacion", values.tipoOperacion);
        requestBody.set("fechaOperacion", values.fechaOperacion);
        requestBody.set("numeroCartaPorte", values.numeroCartaPorte);
        requestBody.set("cliente", values.cliente);
        requestBody.set("producto", values.producto);
        requestBody.set("kilos", String(values.kilos));
        requestBody.set("cantidadEnvases", String(values.cantidadEnvases));
        requestBody.set("envaseTipoId", values.envaseTipoId);
        requestBody.set("observaciones", values.observaciones ?? "");
        requestBody.set("cartaPortePdf", pdfFile);

        const response = await fetch("/api/operaciones/cargas", {
          method: "POST",
          body: requestBody
        });

        const result = (await response.json()) as ActionState<CrearOperacionCargaData>;

        if (!result.ok) {
          setServerError(result.message);

          if (result.fieldErrors) {
            for (const [field, messages] of Object.entries(result.fieldErrors)) {
              const message = messages?.[0];

              if (!message) {
                continue;
              }

              if (field === "cartaPortePdf") {
                form.setError("root.serverError", {
                  type: "server",
                  message
                });
                continue;
              }

              form.setError(field as keyof OperacionCargaFormInput, {
                type: "server",
                message
              });
            }
          }

          return;
        }

        setServerMessage(result.message);
        setPdfFile(null);
        setFileInputKey((currentValue) => currentValue + 1);
        form.reset({
          tipoOperacion: "carga",
          fechaOperacion: getTodayLocalInputValue(),
          numeroCartaPorte: "",
          cliente: "",
          producto: "",
          kilos: 0,
          cantidadEnvases: 0,
          envaseTipoId: values.envaseTipoId,
          observaciones: ""
        });
        router.refresh();
      } catch (error) {
        setServerError(
          error instanceof Error
            ? error.message
            : "No fue posible completar la operacion."
        );
      }
    });
  });

  return (
    <section className="rounded-3xl border border-slate-200/70 bg-white/85 p-8 shadow-sm backdrop-blur">
      <form className="grid gap-6" onSubmit={handleSubmit}>
        <input
          type="hidden"
          defaultValue="carga"
          {...form.register("tipoOperacion")}
        />

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium text-slate-700">
            Fecha de operacion
            <input
              className="rounded-xl border border-slate-300 px-4 py-3 outline-none ring-0 transition focus:border-slate-900"
              type="date"
              {...form.register("fechaOperacion")}
            />
            <FieldError message={form.formState.errors.fechaOperacion?.message} />
          </label>

          <label className="grid gap-2 text-sm font-medium text-slate-700">
            Nro Carta de Porte
            <input
              className="rounded-xl border border-slate-300 px-4 py-3 outline-none ring-0 transition focus:border-slate-900"
              placeholder="CP-00012345"
              {...form.register("numeroCartaPorte")}
            />
            <FieldError message={form.formState.errors.numeroCartaPorte?.message} />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium text-slate-700">
            Cliente
            <input
              className="rounded-xl border border-slate-300 px-4 py-3 outline-none ring-0 transition focus:border-slate-900"
              placeholder="Cliente industrial"
              {...form.register("cliente")}
            />
            <FieldError message={form.formState.errors.cliente?.message} />
          </label>

          <label className="grid gap-2 text-sm font-medium text-slate-700">
            Producto
            <input
              className="rounded-xl border border-slate-300 px-4 py-3 outline-none ring-0 transition focus:border-slate-900"
              placeholder="Harina de soja"
              {...form.register("producto")}
            />
            <FieldError message={form.formState.errors.producto?.message} />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <label className="grid gap-2 text-sm font-medium text-slate-700">
            Kg despachados
            <input
              className="rounded-xl border border-slate-300 px-4 py-3 outline-none ring-0 transition focus:border-slate-900"
              type="number"
              min="0"
              step="0.01"
              {...form.register("kilos", { valueAsNumber: true })}
            />
            <FieldError message={form.formState.errors.kilos?.message} />
          </label>

          <label className="grid gap-2 text-sm font-medium text-slate-700">
            Envases despachados
            <input
              className="rounded-xl border border-slate-300 px-4 py-3 outline-none ring-0 transition focus:border-slate-900"
              type="number"
              min="0"
              step="1"
              {...form.register("cantidadEnvases", { valueAsNumber: true })}
            />
            <FieldError message={form.formState.errors.cantidadEnvases?.message} />
          </label>

          <label className="grid gap-2 text-sm font-medium text-slate-700">
            Tipo de envase
            <select
              className="rounded-xl border border-slate-300 px-4 py-3 outline-none ring-0 transition focus:border-slate-900"
              disabled={options.length === 0}
              {...form.register("envaseTipoId")}
            >
              {options.map((envaseTipo) => (
                <option key={envaseTipo.id} value={envaseTipo.id}>
                  {envaseTipo.nombre}
                </option>
              ))}
            </select>
            <FieldError message={form.formState.errors.envaseTipoId?.message} />
          </label>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <p className="font-medium text-slate-900">Comportamiento del stock</p>
          <p className="mt-1">
            {selectedEnvaseTipo?.controlaStock
              ? "La transaccion descontara stock en envase_stock y generara un egreso en el libro mayor."
              : "El tipo seleccionado no controla stock. La operacion se registrara sin afectar inventario fisico."}
          </p>
        </div>

        <label className="grid gap-2 text-sm font-medium text-slate-700">
          Carta de Porte (PDF)
          <input
            key={fileInputKey}
            className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm outline-none transition file:mr-4 file:rounded-lg file:border-0 file:bg-slate-950 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-800"
            type="file"
            accept="application/pdf"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setPdfFile(file);
            }}
          />
          <span className="text-xs text-slate-500">
            El archivo se sube desde el servidor y se limpia automaticamente si
            la transaccion de Firestore falla.
          </span>
          {pdfFile ? (
            <span className="text-xs text-slate-600">
              Archivo seleccionado: {pdfFile.name} ({formatFileSize(pdfFile.size)} MB)
            </span>
          ) : null}
        </label>

        <label className="grid gap-2 text-sm font-medium text-slate-700">
          Observaciones
          <textarea
            className="min-h-28 rounded-xl border border-slate-300 px-4 py-3 outline-none ring-0 transition focus:border-slate-900"
            placeholder="Observaciones operativas o incidencia de despacho"
            {...form.register("observaciones")}
          />
          <FieldError message={form.formState.errors.observaciones?.message} />
        </label>

        {serverError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            {serverError}
          </div>
        ) : null}

        {serverMessage ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            {serverMessage}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={isPending || options.length === 0}
            type="submit"
          >
            {isPending ? "Registrando..." : "Registrar carga"}
          </button>
          <span className="text-sm text-slate-500">
            La persistencia es atomica: operacion, movimiento y stock se
            confirman o fallan juntos.
          </span>
        </div>
      </form>
    </section>
  );
}

type FieldErrorProps = {
  message?: string;
};

function FieldError({ message }: FieldErrorProps) {
  if (!message) {
    return null;
  }

  return <span className="text-xs text-rose-700">{message}</span>;
}
