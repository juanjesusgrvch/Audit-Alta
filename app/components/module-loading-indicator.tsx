import { LoaderIcon } from "@/app/components/console-icons";

export function ModuleLoadingIndicator({
  isLoading
}: {
  isLoading: boolean;
}) {
  if (!isLoading) {
    return null;
  }

  return (
    <span className="inline-flex items-center justify-center text-[var(--primary)]">
      <LoaderIcon className="h-5 w-5" />
    </span>
  );
}
