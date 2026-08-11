import { useCallback, useState } from 'react';
import { mensagemErroAcao } from '../lib/erros';
import { controlarScraper } from '../lib/scraperControl';
import { useScraperRun } from '../hooks/useScraperRun';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useNomesSitesAtivos } from '../hooks/useSitesAtivos';
import { StatusExecucaoScraper } from '../components/StatusExecucaoScraper';
import { AdicionarDominioManual } from '../components/AdicionarDominioManual';
import { AprovacaoDominios } from '../components/AprovacaoDominios';
import { DominiosSemAdaptador } from '../components/DominiosSemAdaptador';
import { FilaAprovacoes } from '../components/FilaAprovacoes';
import { ConfigMatchTitulo } from '../components/ConfigMatchTitulo';

function SecaoScraperApprovals({ sitesSuportados }: { sitesSuportados: string[] }) {
  return (
    <section className="atualizacao-secao">
      <h3>Scraper approvals</h3>
      <p className="atualizacao-subtitulo-nota">
        A source you add manually is saved right away, but its domain only gets scraped automatically once approved
        here. You can also add a known-safe domain directly, without adding a source first — this also reactivates a
        previously rejected domain.
      </p>
      <AdicionarDominioManual />
      <AprovacaoDominios />
      <DominiosSemAdaptador />
      <FilaAprovacoes titulo="Works" escopo="suportados" sitesSuportados={sitesSuportados} />
    </section>
  );
}

function SecaoSearchSources({ sitesSuportados }: { sitesSuportados: string[] }) {
  const { run, carregando, erro, recarregar } = useScraperRun('fontes');

  const rodando = run?.status === 'rodando';

  const { executar: handleAcao, executando: acionando, erro: erroAcao } = useAsyncAction(
    useCallback(async () => {
      try {
        await controlarScraper('fontes', rodando ? 'stop' : 'start');
        await recarregar();
      } catch (err) {
        throw new Error(mensagemErroAcao(err));
      }
    }, [rodando, recarregar])
  );

  return (
    <section className="atualizacao-secao">
      <h3>Search Sources</h3>
      <p>
        Search for brand-new sources (outside your supported sites) for works that don't have any yet. Web results go
        through a stricter title-match threshold and land in the approvals queue below.
      </p>

      <div className="scraper-controles">
        <button type="button" onClick={handleAcao} disabled={acionando}>
          {acionando ? 'Please wait…' : rodando ? 'Stop search' : 'Find new sources'}
        </button>
      </div>
      {erroAcao && <p className="execucao-status execucao-erro">{erroAcao}</p>}

      <StatusExecucaoScraper run={run} carregando={carregando} erro={erro} />

      <FilaAprovacoes titulo="New sources" escopo="novas" sitesSuportados={sitesSuportados} comBlacklist />
    </section>
  );
}

/** Settings > Sources: aprovação de domínio/fonte (movido de Updates) + busca de novas fontes + config de match. */
export function SourcesPage() {
  const sitesSuportados = useNomesSitesAtivos();
  const [matchAberto, setMatchAberto] = useState(false);

  return (
    <div className="sources-pagina">
      <div className="sources-topo">
        <h1>Sources</h1>
        <p className="sources-subtitulo">Approve domains and sources, and search for new ones.</p>
      </div>

      <SecaoScraperApprovals sitesSuportados={sitesSuportados} />
      <SecaoSearchSources sitesSuportados={sitesSuportados} />

      <section className="atualizacao-secao">
        <button
          type="button"
          className="fila-aprovacoes-toggle"
          onClick={() => setMatchAberto((v) => !v)}
          aria-expanded={matchAberto}
        >
          {matchAberto ? '▾' : '▸'} Match settings
        </button>
        {matchAberto && <ConfigMatchTitulo />}
      </section>
    </div>
  );
}
