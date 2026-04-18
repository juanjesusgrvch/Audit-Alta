import { AuthGuard } from "@/app/components/auth-guard";
import { EnvasesModuleScreen } from "@/app/components/envases-module-screen";
import { OperationModuleScreen } from "@/app/components/operation-module-screen";
import { ProcessModuleScreen } from "@/app/components/process-module-screen";

type ModulesPageProps = {
  searchParams?: Promise<{
    tab?: string;
  }>;
};

type ModuleTab = "descargas" | "cargas" | "envases" | "procesos";

function resolveModuleTab(value?: string): ModuleTab {
  if (value === "cargas" || value === "envases" || value === "procesos") {
    return value;
  }

  return "descargas";
}

export default async function ModulosPage({ searchParams }: ModulesPageProps) {
  const params = searchParams ? await searchParams : undefined;
  const tab = resolveModuleTab(params?.tab);

  return (
    <AuthGuard>
      {tab === "descargas" ? <OperationModuleScreen tipo="ingreso" /> : null}
      {tab === "cargas" ? <OperationModuleScreen tipo="egreso" /> : null}
      {tab === "envases" ? <EnvasesModuleScreen /> : null}
      {tab === "procesos" ? <ProcessModuleScreen /> : null}
    </AuthGuard>
  );
}
