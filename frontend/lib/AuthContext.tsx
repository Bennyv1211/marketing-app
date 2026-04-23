import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, getToken, setToken } from "./api";

type User = { id: string; email: string; full_name?: string; onboarded?: boolean };
type Business = any;

type AuthCtx = {
  user: User | null;
  business: Business | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, full_name?: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const tok = await getToken();
    if (!tok) {
      setUser(null);
      setBusiness(null);
      return;
    }
    try {
      const res: any = await api.me();
      setUser(res.user);
      setBusiness(res.business || null);
    } catch {
      await setToken(null);
      setUser(null);
      setBusiness(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  const signIn = async (email: string, password: string) => {
    const res: any = await api.login(email, password);
    await setToken(res.access_token);
    await refresh();
  };
  const signUp = async (email: string, password: string, full_name?: string) => {
    const res: any = await api.register(email, password, full_name);
    await setToken(res.access_token);
    await refresh();
  };
  const signOut = async () => {
    await setToken(null);
    setUser(null);
    setBusiness(null);
  };

  return (
    <AuthContext.Provider value={{ user, business, loading, signIn, signUp, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
