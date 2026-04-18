"use client";

import { ProcessModuleConsole } from "@/app/components/process-module-console";
import { useOperationModuleData } from "@/lib/client/module-data";
import { useProcesosModuleData } from "@/lib/client/module-data";

export function ProcessModuleScreen() {
  const { data, error, isLoading } = useProcesosModuleData();
  const {
    data: ingresosData,
    isLoading: isLoadingIngresos,
  } = useOperationModuleData("ingreso");

  return (
    <ProcessModuleConsole
      envases={data?.envases ?? []}
      firestoreDisponible={data?.firestoreDisponible ?? false}
      ingresosRelacionados={ingresosData?.registros ?? []}
      isLoading={isLoading || isLoadingIngresos}
      loadError={error}
      registros={data?.registros ?? []}
    />
  );
}
