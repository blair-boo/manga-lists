import { Outlet } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth } from './components/RequireAuth';
import { Layout } from './components/Layout';
import { SyncProvider } from './sync/SyncContext';
import { ToastProvider } from './components/Toast';

export function RootLayout() {
  return (
    <AuthProvider>
      <RequireAuth>
        <SyncProvider>
          <ToastProvider>
            <Layout>
              <Outlet />
            </Layout>
          </ToastProvider>
        </SyncProvider>
      </RequireAuth>
    </AuthProvider>
  );
}
