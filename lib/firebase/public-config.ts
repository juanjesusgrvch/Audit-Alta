export const DEFAULT_PUBLIC_FIREBASE_CONFIG = {
  apiKey: "AIzaSyAZjvIFLnf57y9VJiwzyw9ObLNl8kPWsVU",
  authDomain: "lab-alta.firebaseapp.com",
  projectId: "lab-alta",
  storageBucket: "lab-alta.firebasestorage.app",
  messagingSenderId: "963670520154",
  appId: "1:963670520154:web:84783319441c6383a14363",
  measurementId: "G-RHKSEW5HZH"
} as const;

export function getPublicFirebaseConfig() {
  return {
    apiKey:
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??
      DEFAULT_PUBLIC_FIREBASE_CONFIG.apiKey,
    authDomain:
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??
      DEFAULT_PUBLIC_FIREBASE_CONFIG.authDomain,
    projectId:
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
      DEFAULT_PUBLIC_FIREBASE_CONFIG.projectId,
    storageBucket:
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??
      DEFAULT_PUBLIC_FIREBASE_CONFIG.storageBucket,
    messagingSenderId:
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ??
      DEFAULT_PUBLIC_FIREBASE_CONFIG.messagingSenderId,
    appId:
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID ??
      DEFAULT_PUBLIC_FIREBASE_CONFIG.appId,
    measurementId:
      process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ??
      DEFAULT_PUBLIC_FIREBASE_CONFIG.measurementId
  };
}
