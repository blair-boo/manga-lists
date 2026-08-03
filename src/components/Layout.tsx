import { useEffect, useRef, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useSync } from '../sync/SyncContext';
import { useTema, type TemaPref } from '../hooks/useTema';
import { mensagemDeErro } from '../lib/erros';
import { APP_NAME } from '../config';
import { DialogosProvider } from './Dialogo';
import { ModoEdicaoProvider, useModoEdicao } from './ModoEdicaoContext';
import { IconeModoEdicao, IconeSairModoEdicao } from './Icones';

function formatHora(date: Date | null): string {
  if (!date) return 'never';
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Botão do Edit mode, na extremidade direita da linha das abas. Aparece em
 * TODAS as abas pra a linha não mudar de altura nem de composição ao navegar;
 * fora da aba List (e nela no Grid) fica "só a sombra". O disabled cobre
 * teclado e leitor de tela, o pointer-events: none da classe cobre o toque.
 */
function BotaoModoEdicao() {
  const { modoEdicao, alternarModo, disponivel, setHeaderBotaoVisivel } = useModoEdicao();
  const rotulo = modoEdicao ? 'Exit edit mode' : 'Edit mode';
  const botaoRef = useRef<HTMLButtonElement>(null);

  // O flutuante da lista "descola" deste botão só quando ele sai da tela — ver
  // .modo-edicao-flutuante em lista.css. root:null observa contra a viewport,
  // certo aqui porque o header não é uma sub-área com scroll próprio.
  useEffect(() => {
    const alvo = botaoRef.current;
    if (!alvo) return;
    const observer = new IntersectionObserver(([entry]) => setHeaderBotaoVisivel(entry.isIntersecting), {
      threshold: 0,
    });
    observer.observe(alvo);
    return () => observer.disconnect();
  }, [setHeaderBotaoVisivel]);

  return (
    <button
      ref={botaoRef}
      type="button"
      className={`btn-icone rato-botao modo-edicao-toggle${disponivel ? '' : ' btn-icone-sombra'}`}
      onClick={alternarModo}
      aria-pressed={modoEdicao}
      disabled={!disponivel}
      title={rotulo}
      aria-label={rotulo}
    >
      {modoEdicao ? <IconeSairModoEdicao /> : <IconeModoEdicao />}
    </button>
  );
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
    <DialogosProvider>
      <ModoEdicaoProvider>
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
              {lastError !== null && <span className="sync-error" title={mensagemDeErro(lastError)}>sync error</span>}
              <button type="button" onClick={signOut} className="logout-button">
                Sign out
              </button>
            </div>
            <div className="app-header-main">
              <h1 className="app-title">{APP_NAME}</h1>
              <div className="app-nav-linha">
                <nav className="app-nav">
                  <NavLink to="/" end>
                    List
                  </NavLink>
                  <NavLink to="/atualizacoes">Updates</NavLink>
                  <NavLink to="/cadastrar">Add</NavLink>
                  <NavLink to="/testes">Tests</NavLink>
                </nav>
                <BotaoModoEdicao />
              </div>
            </div>
          </header>
          <main className="app-main">{children}</main>
        </div>
      </ModoEdicaoProvider>
    </DialogosProvider>
  );
}
