import { createBrowserRouter, Navigate } from 'react-router-dom';
import { RootLayout } from './RootLayout';
import { ListaPrincipalPage } from './pages/ListaPrincipalPage';
import { DetalheObraPage } from './pages/DetalheObraPage';
import { CadastrarPage } from './pages/CadastrarPage';
import { AtualizacoesPage } from './pages/AtualizacoesPage';
import { ImportarComixPage } from './pages/ImportarComixPage';
import { SettingsPage } from './pages/SettingsPage';
import { TestesPage } from './pages/TestesPage';
import { GenerosTagsPage } from './pages/GenerosTagsPage';
import { SourcesPage } from './pages/SourcesPage';

export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <RootLayout />,
      children: [
        { index: true, element: <ListaPrincipalPage /> },
        { path: 'obra/:id', element: <DetalheObraPage /> },
        { path: 'cadastrar', element: <CadastrarPage /> },
        { path: 'importar', element: <ImportarComixPage /> },
        {
          path: 'settings',
          element: <SettingsPage />,
          children: [
            { index: true, element: <Navigate to="testes" replace /> },
            { path: 'testes', element: <TestesPage /> },
            { path: 'generos-tags', element: <GenerosTagsPage /> },
            { path: 'sources', element: <SourcesPage /> },
          ],
        },
        // A aba Tests virou sub-aba de Settings — link antigo continua funcionando.
        { path: 'testes', element: <Navigate to="/settings/testes" replace /> },
        // Redirecionam as rotas antigas para a tela unificada de cadastro.
        { path: 'nova-obra', element: <Navigate to="/cadastrar" replace /> },
        { path: 'cadastro-rapido', element: <Navigate to="/cadastrar" replace /> },
        { path: 'atualizacoes', element: <AtualizacoesPage /> },
        { path: '*', element: <Navigate to="/" replace /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL }
);
