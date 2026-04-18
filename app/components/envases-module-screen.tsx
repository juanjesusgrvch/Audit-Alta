"use client";

import { EnvasesConsole } from "@/app/components/envases-console";
import { useEnvasesModuleData } from "@/lib/client/module-data";

export function EnvasesModuleScreen() {
  const { data, error, isLoading } = useEnvasesModuleData();

  return (
    <EnvasesConsole
      clientesDisponibles={data?.clientesDisponibles ?? []}
      envases={data?.envases ?? []}
      firestoreDisponible={data?.firestoreDisponible ?? false}
      historialDerivado={data?.historialDerivado ?? []}
      isLoading={isLoading}
      loadError={error}
      stockPlanta={data?.stockPlanta ?? []}
    />
  );
}
