import { createBrowserRouter, Navigate } from 'react-router-dom';
import { RootLayout } from './RootLayout';
import { ListaPrincipalPage } from './pages/ListaPrincipalPage';
import { DetalheObraPage } from './pages/DetalheObraPage';
import { CadastroObraPage } from './pages/CadastroObraPage';
import { CadastroRapidoPage } from './pages/CadastroRapidoPage';
import { AtualizacoesPage } from './pages/AtualizacoesPage';

export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <RootLayout />,
      children: [
        { index: true, element: <ListaPrincipalPage /> },
        { path: 'obra/:id', element: <DetalheObraPage /> },
        { path: 'nova-obra', element: <CadastroObraPage /> },
        { path: 'cadastro-rapido', element: <CadastroRapidoPage /> },
        { path: 'atualizacoes', element: <AtualizacoesPage /> },
        { path: '*', element: <Navigate to="/" replace /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL }
);
