import "server-only";

import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";

export type RequestActor = {
  uid: string;
  email?: string;
  displayName?: string;
};

function getBearerToken(request: Request) {
  const authorizationHeader = request.headers.get("authorization");

  if (!authorizationHeader?.startsWith("Bearer ")) {
    return null;
  }

  return authorizationHeader.slice("Bearer ".length).trim();
}

export async function getRequestActor(
  request: Request
): Promise<RequestActor | null> {
  const idToken = getBearerToken(request);

  if (!idToken) {
    return null;
  }

  try {
    const decodedToken = await getAdminAuth().verifyIdToken(idToken);

    return {
      uid: decodedToken.uid,
      email: decodedToken.email,
      displayName:
        typeof decodedToken.name === "string" ? decodedToken.name : undefined
    };
  } catch (error) {
    console.error("[auth] No fue posible verificar el token de Firebase.", error);
    return null;
  }
}

export function createUnauthorizedResponse(message = "Sesion no autorizada.") {
  return NextResponse.json(
    {
      ok: false,
      message
    },
    { status: 401 }
  );
}
