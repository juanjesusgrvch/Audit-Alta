import { AuthGuard } from "@/app/components/auth-guard";
import { EnvasesModuleScreen } from "@/app/components/envases-module-screen";
import { OperationModuleScreen } from "@/app/components/operation-module-screen";
import { ProcessModuleScreen } from "@/app/components/process-module-screen";

type ModulesPageProps = {
  searchParams?: Promise<{
    intent?: string;
    recordId?: string;
    source?: string;
    subRecordId?: string;
    tab?: string;
  }>;
};

type ModuleTab = "descargas" | "cargas" | "envases" | "procesos";
type ModuleIntent = "edit" | "delete";

function resolveModuleTab(value?: string): ModuleTab {
  if (value === "cargas" || value === "envases" || value === "procesos") {
    return value;
  }

  return "descargas";
}

function resolveModuleIntent(value?: string): ModuleIntent | undefined {
  return value === "edit" || value === "delete" ? value : undefined;
}

function resolveDeepLinkSource(value?: string) {
  return value === "envases" ? value : undefined;
}

export default async function ModulosPage({ searchParams }: ModulesPageProps) {
  const params = searchParams ? await searchParams : undefined;
  const tab = resolveModuleTab(params?.tab);
  const intent = resolveModuleIntent(params?.intent);
  const source = resolveDeepLinkSource(params?.source);
  const recordId = params?.recordId;
  const subRecordId = params?.subRecordId;

  return (
    <AuthGuard>
      {tab === "descargas" ? (
        <OperationModuleScreen
          deepLinkIntent={intent}
          deepLinkRecordId={recordId}
          deepLinkSource={source}
          tipo="ingreso"
        />
      ) : null}
      {tab === "cargas" ? (
        <OperationModuleScreen
          deepLinkIntent={intent}
          deepLinkRecordId={recordId}
          deepLinkSource={source}
          tipo="egreso"
        />
      ) : null}
      {tab === "envases" ? <EnvasesModuleScreen /> : null}
      {tab === "procesos" ? (
        <ProcessModuleScreen
          deepLinkIntent={intent}
          deepLinkRecordId={recordId}
          deepLinkSource={source}
          deepLinkSubRecordId={subRecordId}
        />
      ) : null}
    </AuthGuard>
  );
}
