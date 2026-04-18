"use client";

import { getClientAuth } from "@/lib/firebase/client";

export async function getCurrentFirebaseIdToken() {
  const currentUser = getClientAuth().currentUser;

  if (!currentUser) {
    return null;
  }

  return currentUser.getIdToken();
}

export async function buildFirebaseAuthHeaders(headers?: HeadersInit) {
  const nextHeaders = new Headers(headers);
  const idToken = await getCurrentFirebaseIdToken();

  if (idToken) {
    nextHeaders.set("Authorization", `Bearer ${idToken}`);
  }

  return nextHeaders;
}

export async function fetchWithFirebaseAuth(
  input: RequestInfo | URL,
  init?: RequestInit
) {
  const headers = await buildFirebaseAuthHeaders(init?.headers);

  return fetch(input, {
    ...init,
    headers
  });
}
