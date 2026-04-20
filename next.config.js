function parseJsonEnv(name) {
  const value = process.env[name];

  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value);
  } catch {
    console.warn(`[next.config] ${name} no contiene un JSON valido.`);
    return {};
  }
}

const firebaseWebAppConfig = parseJsonEnv("FIREBASE_WEBAPP_CONFIG");
const firebaseSystemConfig = parseJsonEnv("FIREBASE_CONFIG");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["firebase-admin"],
  env: {
    NEXT_PUBLIC_FIREBASE_API_KEY:
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??
      firebaseWebAppConfig.apiKey ??
      "",
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??
      firebaseWebAppConfig.authDomain ??
      "",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID:
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
      firebaseWebAppConfig.projectId ??
      firebaseSystemConfig.projectId ??
      "",
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??
      firebaseWebAppConfig.storageBucket ??
      firebaseSystemConfig.storageBucket ??
      "",
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ??
      firebaseWebAppConfig.messagingSenderId ??
      "",
    NEXT_PUBLIC_FIREBASE_APP_ID:
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID ??
      firebaseWebAppConfig.appId ??
      "",
    NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID:
      process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ?? ""
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb"
    }
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "firebasestorage.googleapis.com"
      },
      {
        protocol: "https",
        hostname: "*.firebasestorage.app"
      }
    ]
  }
};

module.exports = nextConfig;
