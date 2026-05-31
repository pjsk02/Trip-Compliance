import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { setToken, getToken } from '../api/client';
import type { Session } from '../types';

interface AuthContextValue {
  session: Session | null;
  login: (session: Session) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Try to rehydrate from sessionStorage on first load.
function loadInitialSession(): Session | null {
  try {
    const raw = sessionStorage.getItem('ts_session');
    if (raw) return JSON.parse(raw) as Session;
  } catch {
    // malformed — ignore
  }
  // If token exists but session blob doesn't, clear the orphaned token.
  if (getToken()) setToken(null);
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(loadInitialSession);

  const login = useCallback((s: Session) => {
    setToken(s.token);
    sessionStorage.setItem('ts_session', JSON.stringify(s));
    setSession(s);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    sessionStorage.removeItem('ts_session');
    setSession(null);
  }, []);

  return (
    <AuthContext.Provider value={{ session, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
