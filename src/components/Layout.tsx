import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useSync } from '../sync/SyncContext';
import { useTema, type TemaPref } from '../hooks/useTema';

function formatHora(date: Date | null): string {
  if (!date) return 'never';
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

const TEMA_INFO: Record<TemaPref, { icone: string; titulo: string }> = {
  light: { icone: '☀️', titulo: 'Theme: light (click for dark)' },
  dark: { icone: '🌙', titulo: 'Theme: dark (click for system)' },
  system: { icone: '🖥️', titulo: 'Theme: system (click for light)' },
};

export function Layout({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const { online, syncing, lastSyncAt, lastError, syncAgora } = useSync();
  const { tema, ciclarTema } = useTema();

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="app-header-top">
          <button
            type="button"
            onClick={ciclarTema}
            className="tema-toggle"
            title={TEMA_INFO[tema].titulo}
            aria-label={TEMA_INFO[tema].titulo}
          >
            {TEMA_INFO[tema].icone}
          </button>
          <span className={`sync-dot ${online ? 'online' : 'offline'}`} title={online ? 'Online' : 'Offline'} />
          <button type="button" onClick={syncAgora} disabled={syncing || !online} className="sync-button">
            {syncing ? 'Syncing…' : `Synced at ${formatHora(lastSyncAt)}`}
          </button>
          {lastError !== null && <span className="sync-error" title={String(lastError)}>sync error</span>}
          <button type="button" onClick={signOut} className="logout-button">
            Sign out
          </button>
        </div>
        <div className="app-header-main">
          <h1 className="app-title">Ratsnest</h1>
          <nav className="app-nav">
            <NavLink to="/" end>
              List
            </NavLink>
            <NavLink to="/atualizacoes">Updates</NavLink>
            <NavLink to="/cadastrar">Add</NavLink>
          </nav>
        </div>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
