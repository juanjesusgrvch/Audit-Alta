"use client";

import { CargasConsole } from "@/app/components/cargas-console";
import { DescargasConsole } from "@/app/components/descargas-console";
import type { EnvaseOption, RegistroOperacion } from "@/lib/services/operaciones";
import type { TipoModuloOperacion } from "@/types/schema";

type OperationModuleConsoleProps = {
  tipo: TipoModuloOperacion;
  registros: RegistroOperacion[];
  relationalRecords: RegistroOperacion[];
  envases: EnvaseOption[];
  firestoreDisponible: boolean;
  isLoading?: boolean;
  loadError?: string | null;
  storageConfigurado: boolean;
};

export function OperationModuleConsole({
  tipo,
  registros,
  relationalRecords,
  envases,
  firestoreDisponible,
  isLoading = false,
  loadError = null,
  storageConfigurado
}: OperationModuleConsoleProps) {
  if (tipo === "ingreso") {
    return (
      <DescargasConsole
        envases={envases}
        firestoreDisponible={firestoreDisponible}
        isLoading={isLoading}
        loadError={loadError}
        registros={registros}
        storageConfigurado={storageConfigurado}
      />
    );
  }

  return (
    <CargasConsole
      envases={envases}
      firestoreDisponible={firestoreDisponible}
      isLoading={isLoading}
      loadError={loadError}
      relationalRecords={relationalRecords}
      registros={registros}
      storageConfigurado={storageConfigurado}
    />
  );
}
