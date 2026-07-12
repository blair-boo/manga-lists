import { createBrowserRouter, Navigate } from 'react-router-dom';
import { RootLayout } from './RootLayout';
import { ListaPrincipalPage } from './pages/ListaPrincipalPage';
import { DetalheObraPage } from './pages/DetalheObraPage';
import { FontesPendentesPage } from './pages/FontesPendentesPage';
import { CadastroObraPage } from './pages/CadastroObraPage';
import { CadastroRapidoPage } from './pages/CadastroRapidoPage';
import { AtualizacaoMassaPage } from './pages/AtualizacaoMassaPage';

export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <RootLayout />,
      children: [
        { index: true, element: <ListaPrincipalPage /> },
        { path: 'obra/:id', element: <DetalheObraPage /> },
        { path: 'fontes-pendentes', element: <FontesPendentesPage /> },
        { path: 'nova-obra', element: <CadastroObraPage /> },
        { path: 'cadastro-rapido', element: <CadastroRapidoPage /> },
        { path: 'atualizacao-massa', element: <AtualizacaoMassaPage /> },
        { path: '*', element: <Navigate to="/" replace /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL }
);
