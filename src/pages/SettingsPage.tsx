import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useDialogos } from '../components/Dialogo';
import { IconeHardSync, IconeLimparCache } from '../components/Icones';
import { useToast } from '../components/Toast';
import { limparCachesApp } from '../lib/cacheApp';
import { mensagemDeErro } from '../lib/erros';
import { hardSync, isOnline } from '../sync/sync';

/** Aba Settings: sub-nav (Tests, Genres/Tags, Sources, Images, Format, Backup) + ações Hard Sync/Empty Cache + conteúdo da sub-aba ativa. */
export function SettingsPage() {
  const { confirmar } = useDialogos();
  const { mostrarToast } = useToast();
  const [executando, setExecutando] = useState(false);

  async function executarHardSync() {
    const ok = await confirmar({
      titulo: 'Hard Sync',
      mensagem:
        'This re-downloads all data from the server. Local changes that have not been synced yet are kept. It may take a while.',
      confirmarRotulo: 'Hard Sync',
      perigoso: true,
    });
    if (!ok) return;
    setExecutando(true);
    try {
      const r = await hardSync();
      if (r.ok) mostrarToast('Hard sync complete');
      else mostrarToast(r.error === 'offline' ? 'You are offline' : `Hard sync failed: ${mensagemDeErro(r.error)}`, 'erro');
    } finally {
      setExecutando(false);
    }
  }

  async function executarLimparCache() {
    const ok = await confirmar({
      titulo: 'Empty Cache',
      mensagem:
        'This deletes the app caches (covers and offline files will be downloaded again, so you need a connection) and reloads the page. Your data and unsynced changes are not affected.',
      confirmarRotulo: 'Empty Cache',
      perigoso: true,
    });
    if (!ok) return;
    // Offline: sem rede não dá pra repor o cache depois, então não apaga.
    if (!isOnline()) {
      mostrarToast('You are offline: cache not emptied', 'erro');
      return;
    }
    setExecutando(true);
    try {
      await limparCachesApp();
      window.location.reload();
    } catch (error) {
      mostrarToast(`Could not empty cache: ${mensagemDeErro(error)}`, 'erro');
      setExecutando(false);
    }
  }

  return (
    <div className="settings-pagina">
      <nav className="settings-subnav">
        <NavLink to="testes">Tests</NavLink>
        <NavLink to="generos-tags">Genres/Tags</NavLink>
        <NavLink to="sources">Sources</NavLink>
        <NavLink to="images">Images</NavLink>
        <NavLink to="format">Format</NavLink>
        <NavLink to="backup">Backup</NavLink>
        <button
          type="button"
          className="btn-icone settings-acao-icone"
          onClick={() => void executarHardSync()}
          disabled={executando}
          title="Hard Sync"
          aria-label="Hard Sync"
        >
          <IconeHardSync />
        </button>
        <button
          type="button"
          className="btn-icone settings-acao-icone"
          onClick={() => void executarLimparCache()}
          disabled={executando}
          title="Empty Cache"
          aria-label="Empty Cache"
        >
          <IconeLimparCache />
        </button>
      </nav>
      <Outlet />
    </div>
  );
}
