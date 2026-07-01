import { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import * as authLib from '@/lib/auth';

interface CurrentUser {
  userId: string;
  email: string;
  name: string;
  role: 'pm' | 'sa' | 'engineer' | 'leadership' | 'admin';
  groups: string[];
}

interface AuthContextType {
  user: CurrentUser | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    async function init(): Promise<void> {
      try {
        // 1. Try to restore from Cognito's localStorage session (survives page reload)
        const restored = authLib.restoreSession();
        if (restored) {
          setUser(restored);
          setLoading(false);
          return;
        }

        // 2. Access token expired or missing — try silent refresh
        // restoreSession() already loaded the refresh token into memory if available
        const refreshed = await authLib.refreshTokens();
        if (refreshed) {
          setUser(authLib.getCurrentUser());
        }
      } catch {
        // No valid session — user must log in
      } finally {
        setLoading(false);
      }
    }

    void init();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      const userData = await authLib.login(email, password);
      setUser(userData);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    authLib.logout();
    setUser(null);
  }, []);

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user,
    loading,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
