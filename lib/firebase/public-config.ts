export type PublicFirebaseConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
};

function normalizePublicEnvValue(value: string | undefined) {
  const normalizedValue = value?.trim();

  return normalizedValue && normalizedValue.length > 0
    ? normalizedValue
    : undefined;
}

export function getOptionalPublicFirebaseConfig(): Partial<PublicFirebaseConfig> {
  return {
    apiKey: normalizePublicEnvValue(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
    authDomain: normalizePublicEnvValue(
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
    ),
    projectId: normalizePublicEnvValue(
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    ),
    storageBucket: normalizePublicEnvValue(
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
    ),
    messagingSenderId: normalizePublicEnvValue(
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
    ),
    appId: normalizePublicEnvValue(process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
    measurementId: normalizePublicEnvValue(
      process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
    )
  };
}

export function getPublicFirebaseConfig() {
  const config = getOptionalPublicFirebaseConfig();
  const missingKeys = [
    ["NEXT_PUBLIC_FIREBASE_API_KEY", config.apiKey],
    ["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", config.authDomain],
    ["NEXT_PUBLIC_FIREBASE_PROJECT_ID", config.projectId],
    ["NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", config.storageBucket],
    [
      "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
      config.messagingSenderId
    ],
    ["NEXT_PUBLIC_FIREBASE_APP_ID", config.appId]
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missingKeys.length > 0) {
    throw new Error(
      `Faltan variables publicas de Firebase: ${missingKeys.join(", ")}.`
    );
  }

  return {
    apiKey: config.apiKey!,
    authDomain: config.authDomain!,
    projectId: config.projectId!,
    storageBucket: config.storageBucket!,
    messagingSenderId: config.messagingSenderId!,
    appId: config.appId!,
    measurementId: config.measurementId
  };
}
