import "server-only";

type FirebaseSystemConfig = {
  projectId?: string;
  storageBucket?: string;
};

let warnedAboutInvalidFirebaseConfig = false;

function parseFirebaseConfigEnv() {
  const rawConfig = process.env.FIREBASE_CONFIG?.trim();

  if (!rawConfig) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawConfig) as Record<string, unknown>;

    return {
      projectId:
        typeof parsed.projectId === "string" && parsed.projectId.trim().length > 0
          ? parsed.projectId.trim()
          : undefined,
      storageBucket:
        typeof parsed.storageBucket === "string" &&
        parsed.storageBucket.trim().length > 0
          ? parsed.storageBucket.trim()
          : undefined
    } satisfies FirebaseSystemConfig;
  } catch {
    if (!warnedAboutInvalidFirebaseConfig) {
      console.warn(
        "[firebase-admin] FIREBASE_CONFIG no contiene un JSON valido. Se omitira como fallback."
      );
      warnedAboutInvalidFirebaseConfig = true;
    }

    return null;
  }
}

export function getFirebaseSystemConfig(): FirebaseSystemConfig {
  return parseFirebaseConfigEnv() ?? {};
}
