import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useSync } from '../sync/SyncContext';

function formatHora(date: Date | null): string {
  if (!date) return 'nunca';
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function Layout({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const { online, syncing, lastSyncAt, lastError, syncAgora } = useSync();

  return (
    <div className="app-layout">
      <header className="app-header">
        <h1 className="app-title">Minha Lista</h1>
        <nav className="app-nav">
          <NavLink to="/" end>
            Lista
          </NavLink>
          <NavLink to="/fontes-pendentes">Fontes pendentes</NavLink>
          <NavLink to="/nova-obra">Nova obra</NavLink>
          <NavLink to="/cadastro-rapido">Cadastro rápido</NavLink>
          <NavLink to="/atualizacao-massa">Atualização em massa</NavLink>
        </nav>
        <div className="app-sync-status">
          <span className={`sync-dot ${online ? 'online' : 'offline'}`} title={online ? 'Online' : 'Offline'} />
          <button type="button" onClick={syncAgora} disabled={syncing || !online} className="sync-button">
            {syncing ? 'Sincronizando…' : `Sincronizado às ${formatHora(lastSyncAt)}`}
          </button>
          {lastError !== null && <span className="sync-error" title={String(lastError)}>erro na sync</span>}
          <button type="button" onClick={signOut} className="logout-button">
            Sair
          </button>
        </div>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
