"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getPublicFirebaseConfig } from "@/lib/firebase/public-config";

let analyticsPromise: Promise<unknown | null> | null = null;

export function getClientFirebaseApp() {
  if (getApps().length > 0) {
    return getApp();
  }

  return initializeApp(getPublicFirebaseConfig());
}

export function getClientDb() {
  return getFirestore(getClientFirebaseApp());
}

export function getClientAuth() {
  return getAuth(getClientFirebaseApp());
}

export async function getClientAnalytics() {
  if (typeof window === "undefined") {
    return null;
  }

  if (!analyticsPromise) {
    analyticsPromise = (async () => {
      const [{ getAnalytics, isSupported }, app] = await Promise.all([
        import("firebase/analytics"),
        Promise.resolve(getClientFirebaseApp())
      ]);

      if (!(await isSupported())) {
        return null;
      }

      return getAnalytics(app);
    })();
  }

  return analyticsPromise;
}
