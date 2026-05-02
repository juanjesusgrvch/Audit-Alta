"use client";

const STORAGE_PREFIX = "audit-alta:module-ui-state";
const STORAGE_VERSION = 1;
const STORAGE_TTL_MS = 1000 * 60 * 15;

type PersistedModuleUiState<TData> = {
  version: number;
  savedAt: number;
  data: TData;
};

function getStorageKey(moduleKey: string) {
  return `${STORAGE_PREFIX}:${moduleKey}`;
}

export function readModuleUiState<TData>(moduleKey: string): TData | null {
  if (typeof window === "undefined") {
    return null;
  }

  const storageKey = getStorageKey(moduleKey);

  try {
    const rawValue = window.localStorage.getItem(storageKey);

    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as PersistedModuleUiState<TData>;

    if (
      parsed.version !== STORAGE_VERSION ||
      typeof parsed.savedAt !== "number" ||
      !("data" in parsed)
    ) {
      window.localStorage.removeItem(storageKey);
      return null;
    }

    if (Date.now() - parsed.savedAt > STORAGE_TTL_MS) {
      window.localStorage.removeItem(storageKey);
      return null;
    }

    return parsed.data;
  } catch {
    window.localStorage.removeItem(storageKey);
    return null;
  }
}

export function writeModuleUiState<TData>(moduleKey: string, data: TData) {
  if (typeof window === "undefined") {
    return;
  }

  const payload: PersistedModuleUiState<TData> = {
    version: STORAGE_VERSION,
    savedAt: Date.now(),
    data,
  };

  try {
    window.localStorage.setItem(getStorageKey(moduleKey), JSON.stringify(payload));
  } catch {
    // Ignore quota or privacy-mode write failures.
  }
}
