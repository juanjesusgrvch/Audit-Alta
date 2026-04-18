import "server-only";

import {
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp,
  type App,
  type AppOptions
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { DEFAULT_PUBLIC_FIREBASE_CONFIG } from "@/lib/firebase/public-config";

declare global {
  var __firebaseAdminApp__: App | undefined;
}

let warnedAboutApplicationDefault = false;

function getFirebaseProjectId() {
  const projectId =
    process.env.FIREBASE_PROJECT_ID ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
    DEFAULT_PUBLIC_FIREBASE_CONFIG.projectId;

  return projectId;
}

export function getFirebaseStorageBucketName() {
  const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET ??
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??
    DEFAULT_PUBLIC_FIREBASE_CONFIG.storageBucket;

  return storageBucket;
}

function hasServiceAccountEnv() {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY
  );
}

function hasGoogleApplicationCredentialsEnv() {
  return Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim());
}

export function getAdminApp(): App {
  if (global.__firebaseAdminApp__) {
    return global.__firebaseAdminApp__;
  }

  if (getApps().length > 0) {
    global.__firebaseAdminApp__ = getApp();
    return global.__firebaseAdminApp__;
  }

  const options: AppOptions = {
    projectId: getFirebaseProjectId(),
    storageBucket: getFirebaseStorageBucketName()
  };

  if (hasServiceAccountEnv()) {
    options.credential = cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
    });
  } else {
    if (!warnedAboutApplicationDefault && !hasGoogleApplicationCredentialsEnv()) {
      console.warn(
        "[firebase-admin] FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY no estan configuradas. Se usara applicationDefault()."
      );
      warnedAboutApplicationDefault = true;
    }

    options.credential = applicationDefault();
  }

  global.__firebaseAdminApp__ = initializeApp(options);

  return global.__firebaseAdminApp__;
}

export function getAdminDb() {
  return getFirestore(getAdminApp());
}

export function getAdminAuth() {
  return getAuth(getAdminApp());
}

export function getAdminStorage() {
  return getStorage(getAdminApp());
}
