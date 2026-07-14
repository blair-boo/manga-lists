import { createBrowserRouter, Navigate } from 'react-router-dom';
import { RootLayout } from './RootLayout';
import { ListaPrincipalPage } from './pages/ListaPrincipalPage';
import { DetalheObraPage } from './pages/DetalheObraPage';
import { CadastrarPage } from './pages/CadastrarPage';
import { AtualizacoesPage } from './pages/AtualizacoesPage';

export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <RootLayout />,
      children: [
        { index: true, element: <ListaPrincipalPage /> },
        { path: 'obra/:id', element: <DetalheObraPage /> },
        { path: 'cadastrar', element: <CadastrarPage /> },
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
