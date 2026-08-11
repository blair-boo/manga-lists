import { NavLink, Outlet } from 'react-router-dom';

/** Aba Settings: sub-nav (Tests, Genres/Tags, Sources) + conteúdo da sub-aba ativa. */
export function SettingsPage() {
  return (
    <div className="settings-pagina">
      <nav className="settings-subnav">
        <NavLink to="testes">Tests</NavLink>
        <NavLink to="generos-tags">Genres/Tags</NavLink>
        <NavLink to="sources">Sources</NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
