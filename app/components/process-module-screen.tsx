"use client";

import { ProcessModuleConsole } from "@/app/components/process-module-console";
import { useOperationModuleData } from "@/lib/client/module-data";
import { useProcesosModuleData } from "@/lib/client/module-data";

type ProcessModuleScreenProps = {
  deepLinkIntent?: "edit" | "delete";
  deepLinkRecordId?: string;
  deepLinkSource?: "envases";
  deepLinkSubRecordId?: string;
};

export function ProcessModuleScreen({
  deepLinkIntent,
  deepLinkRecordId,
  deepLinkSource,
  deepLinkSubRecordId,
}: ProcessModuleScreenProps) {
  const { data, error, isLoading } = useProcesosModuleData();
  const {
    data: ingresosData,
    isLoading: isLoadingIngresos,
  } = useOperationModuleData("ingreso");

  return (
    <ProcessModuleConsole
      envases={data?.envases ?? []}
      deepLinkIntent={deepLinkIntent}
      deepLinkRecordId={deepLinkRecordId}
      deepLinkSource={deepLinkSource}
      deepLinkSubRecordId={deepLinkSubRecordId}
      firestoreDisponible={data?.firestoreDisponible ?? false}
      ingresosRelacionados={ingresosData?.registros ?? []}
      isLoading={isLoading || isLoadingIngresos}
      loadError={error}
      registros={data?.registros ?? []}
    />
  );
}
