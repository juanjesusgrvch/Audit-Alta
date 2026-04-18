"use client";

import { useOperationModuleData } from "@/lib/client/module-data";
import { OperationModuleConsole } from "@/app/components/operation-module-console";
import type { TipoModuloOperacion } from "@/types/schema";

export function OperationModuleScreen({ tipo }: { tipo: TipoModuloOperacion }) {
  const { data, error, isLoading } = useOperationModuleData(tipo);
  const {
    data: descargasData,
    isLoading: isLoadingDescargasRelacionadas,
  } = useOperationModuleData("ingreso");

  return (
    <OperationModuleConsole
      envases={data?.envases ?? []}
      firestoreDisponible={data?.firestoreDisponible ?? false}
      isLoading={isLoading || (tipo === "egreso" && isLoadingDescargasRelacionadas)}
      loadError={error}
      relationalRecords={
        tipo === "egreso" ? descargasData?.registros ?? [] : data?.registros ?? []
      }
      registros={data?.registros ?? []}
      storageConfigurado={data?.storageConfigurado ?? false}
      tipo={tipo}
    />
  );
}
