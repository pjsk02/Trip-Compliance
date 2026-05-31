import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { setToken, getToken } from '../api/client';
import type { Session, UserSession } from '../types';

interface AuthContextValue {
  /** Google-level identity — survives across groups and page reloads. */
  userSession: UserSession | null;
  /** Group-level membership token — set after entering a specific group. */
  session: Session | null;
  loginUser: (us: UserSession) => void;
  loginGroup: (s: Session) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadUserSession(): UserSession | null {
  try {
    const raw = localStorage.getItem('ts_user_session');
    if (raw) return JSON.parse(raw) as UserSession;
  } catch { /* ignore */ }
  return null;
}

function loadGroupSession(): Session | null {
  try {
    const raw = sessionStorage.getItem('ts_session');
    if (raw) return JSON.parse(raw) as Session;
  } catch { /* ignore */ }
  if (getToken()) setToken(null);
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userSession, setUserSession] = useState<UserSession | null>(loadUserSession);
  const [session,     setSession]     = useState<Session | null>(loadGroupSession);

  const loginUser = useCallback((us: UserSession) => {
    localStorage.setItem('ts_user_session', JSON.stringify(us));
    setUserSession(us);
  }, []);

  const loginGroup = useCallback((s: Session) => {
    setToken(s.token);
    sessionStorage.setItem('ts_session', JSON.stringify(s));
    setSession(s);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    localStorage.removeItem('ts_user_session');
    sessionStorage.removeItem('ts_session');
    setUserSession(null);
    setSession(null);
  }, []);

  return (
    <AuthContext.Provider value={{ userSession, session, loginUser, loginGroup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
