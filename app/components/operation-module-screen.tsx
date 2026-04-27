"use client";

import { useOperationModuleData } from "@/lib/client/module-data";
import { OperationModuleConsole } from "@/app/components/operation-module-console";
import type { TipoModuloOperacion } from "@/types/schema";

type OperationModuleScreenProps = {
  tipo: TipoModuloOperacion;
  deepLinkIntent?: "edit" | "delete";
  deepLinkRecordId?: string;
  deepLinkSource?: "envases";
};

export function OperationModuleScreen({
  tipo,
  deepLinkIntent,
  deepLinkRecordId,
  deepLinkSource,
}: OperationModuleScreenProps) {
  const { data, error, isLoading } = useOperationModuleData(tipo);
  const {
    data: descargasData,
    isLoading: isLoadingDescargasRelacionadas,
  } = useOperationModuleData("ingreso");

  return (
    <OperationModuleConsole
      envases={data?.envases ?? []}
      firestoreDisponible={data?.firestoreDisponible ?? false}
      deepLinkIntent={deepLinkIntent}
      deepLinkRecordId={deepLinkRecordId}
      deepLinkSource={deepLinkSource}
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
