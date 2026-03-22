"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  role: string;
}

interface AuthState {
  /** true while the initial /api/auth fetch is in flight */
  loading: boolean;
  /** null when unauthenticated or still loading */
  user: AuthUser | null;
  /** call after logout to reset state */
  clearAuth: () => void;
}

const AuthContext = createContext<AuthState>({
  loading: true,
  user: null,
  clearAuth: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth")
      .then((res) => {
        if (!res.ok) return null;
        return res.json() as Promise<{ authenticated: boolean; candidate?: AuthUser }>;
      })
      .then((data) => {
        if (cancelled) return;
        if (data?.authenticated && data.candidate) {
          setUser(data.candidate);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const clearAuth = useCallback(() => {
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ loading, user, clearAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
