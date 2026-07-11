import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { LoginPage } from '../pages/LoginPage';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();

  if (loading) return <div className="loading-screen">Carregando…</div>;
  if (!session) return <LoginPage />;
  return <>{children}</>;
}
