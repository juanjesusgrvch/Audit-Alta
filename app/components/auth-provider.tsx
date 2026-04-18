"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import {
  browserLocalPersistence,
  onIdTokenChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type User
} from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getClientAuth, getClientDb } from "@/lib/firebase/client";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
};

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function mapUser(user: User): AuthUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL
  };
}

async function syncUsuarioSesion(user: User) {
  try {
    await setDoc(
      doc(getClientDb(), "usuarios", user.uid),
      {
        uid: user.uid,
        email: user.email ?? "",
        displayName: user.displayName ?? "",
        photoURL: user.photoURL ?? null,
        lastSeenAt: serverTimestamp()
      },
      { merge: true }
    );
  } catch {
    // El login no debe depender de este write auxiliar.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    const auth = getClientAuth();

    void setPersistence(auth, browserLocalPersistence).catch(() => undefined);

    const unsubscribe = onIdTokenChanged(auth, (nextUser) => {
      if (!nextUser) {
        setUser(null);
        setStatus("unauthenticated");
        return;
      }

      setUser(mapUser(nextUser));
      setStatus("authenticated");
      void syncUsuarioSesion(nextUser);
    });

    return unsubscribe;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      login: async (email, password) => {
        const auth = getClientAuth();
        await setPersistence(auth, browserLocalPersistence);
        await signInWithEmailAndPassword(auth, email, password);
      },
      logout: async () => {
        await signOut(getClientAuth());
      }
    }),
    [status, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth debe usarse dentro de AuthProvider.");
  }

  return context;
}
