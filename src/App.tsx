import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth } from './components/RequireAuth';
import { Layout } from './components/Layout';
import { SyncProvider } from './sync/SyncContext';
import { ListaPrincipalPage } from './pages/ListaPrincipalPage';
import { DetalheObraPage } from './pages/DetalheObraPage';
import { FontesPendentesPage } from './pages/FontesPendentesPage';
import { CadastroObraPage } from './pages/CadastroObraPage';
import { CadastroRapidoPage } from './pages/CadastroRapidoPage';

export default function App() {
  return (
    <AuthProvider>
      <RequireAuth>
        <SyncProvider>
          <Layout>
            <Routes>
              <Route path="/" element={<ListaPrincipalPage />} />
              <Route path="/obra/:id" element={<DetalheObraPage />} />
              <Route path="/fontes-pendentes" element={<FontesPendentesPage />} />
              <Route path="/nova-obra" element={<CadastroObraPage />} />
              <Route path="/cadastro-rapido" element={<CadastroRapidoPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        </SyncProvider>
      </RequireAuth>
    </AuthProvider>
  );
}
