import { Outlet } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth } from './components/RequireAuth';
import { Layout } from './components/Layout';
import { SyncProvider } from './sync/SyncContext';

export function RootLayout() {
  return (
    <AuthProvider>
      <RequireAuth>
        <SyncProvider>
          <Layout>
            <Outlet />
          </Layout>
        </SyncProvider>
      </RequireAuth>
    </AuthProvider>
  );
}
