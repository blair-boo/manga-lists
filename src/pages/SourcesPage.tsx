import { useCallback, useState } from 'react';
import { mensagemErroAcao } from '../lib/erros';
import { controlarScraper, pararScraperManualmente } from '../lib/scraperControl';
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
  const { run, rodando, travada, carregando, erro, recarregar } = useScraperRun('fontes');

  // Só inicia/para manualmente por este botão (o workflow no GitHub não tem
  // agendamento — dispara só via 'workflow_dispatch'). Se a última run ficou
  // travada (o processo morreu sem gravar o status final — ver useScraperRun),
  // ela nunca conta como "rodando" pra UI, e clicar Find de novo marca a run
  // velha como encerrada antes de disparar a nova.
  const { executar: handleAcao, executando: acionando, erro: erroAcao } = useAsyncAction(
    useCallback(async () => {
      try {
        if (rodando && run) {
          await pararScraperManualmente('fontes', run.id);
        } else {
          if (travada && run) await pararScraperManualmente('fontes', run.id).catch(() => {});
          await controlarScraper('fontes', 'start');
        }
        await recarregar();
      } catch (err) {
        throw new Error(mensagemErroAcao(err));
      }
    }, [rodando, travada, run, recarregar])
  );

  return (
    <section className="atualizacao-secao">
      <h3>Search New Sources</h3>
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
      {travada && (
        <p className="execucao-status execucao-erro">
          The previous run looks stuck (never finished) — starting a new search will mark it as stopped.
        </p>
      )}

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
