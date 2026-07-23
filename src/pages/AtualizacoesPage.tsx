import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { mensagemErroAcao } from '../lib/erros';
import { controlarScraper } from '../lib/scraperControl';
import { useScraperRun } from '../hooks/useScraperRun';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { StatusExecucaoScraper } from '../components/StatusExecucaoScraper';
import { ListaSitesSuportados } from '../components/ListaSitesSuportados';
import { DominiosSemAdaptador } from '../components/DominiosSemAdaptador';
import { AprovacaoDominios } from '../components/AprovacaoDominios';
import { AdicionarDominioManual } from '../components/AdicionarDominioManual';
import { CsvBulkSection } from '../components/CsvBulkSection';
import { FilaAprovacoes } from '../components/FilaAprovacoes';
import { SecaoNovelUpdates } from '../components/SecaoNovelUpdates';
import { ConfigMatchTitulo } from '../components/ConfigMatchTitulo';
import type { ScraperTipo } from '../types';

function SecaoSitesSuportados({ sitesSuportados }: { sitesSuportados: string[] }) {
  const capitulos = useScraperRun('capitulos');
  const [acionando, setAcionando] = useState<ScraperTipo | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  async function disparar(tipo: ScraperTipo) {
    setAcionando(tipo);
    setErroAcao(null);
    try {
      await controlarScraper(tipo, 'start');
      if (tipo === 'capitulos') await capitulos.recarregar();
    } catch (err) {
      setErroAcao(mensagemErroAcao(err));
    } finally {
      setAcionando(null);
    }
  }

  return (
    <section className="atualizacao-secao">
      <h3>Supported sites</h3>
      <p>
        Update the latest chapter of your approved sources, and scan supported sites' catalogs to link works you
        already track but don't have a source on that site yet.
      </p>

      <div className="scraper-controles">
        <button type="button" onClick={() => disparar('capitulos')} disabled={acionando !== null}>
          {acionando === 'capitulos' ? 'Please wait…' : 'Update chapters'}
        </button>
        <button type="button" onClick={() => disparar('obras')} disabled={acionando !== null}>
          {acionando === 'obras' ? 'Please wait…' : 'Update works'}
        </button>
      </div>
      {erroAcao && <p className="execucao-status execucao-erro">{erroAcao}</p>}

      <h4 className="atualizacao-subtitulo">Chapters — latest run</h4>
      <StatusExecucaoScraper run={capitulos.run} carregando={capitulos.carregando} erro={capitulos.erro} />

      <ListaSitesSuportados />

      <h4 className="atualizacao-subtitulo">Domain approvals</h4>
      <p className="atualizacao-subtitulo-nota">
        A source you add manually is saved right away, but its domain only gets scraped automatically once approved
        here. You can also add a known-safe domain directly, without adding a source first — this also reactivates a
        previously rejected domain.
      </p>
      <AdicionarDominioManual />
      <AprovacaoDominios />

      <DominiosSemAdaptador />

      <FilaAprovacoes titulo="Approvals" escopo="suportados" sitesSuportados={sitesSuportados} />
    </section>
  );
}

function SecaoNovasFontes({ sitesSuportados }: { sitesSuportados: string[] }) {
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
      <h3>New sources</h3>
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

      <FilaAprovacoes titulo="Approvals" escopo="novas" sitesSuportados={sitesSuportados} comBlacklist />
    </section>
  );
}

// Oculta a seção de Novel Updates na tela (não remove a funcionalidade — só a
// renderização): o scraper de NU tem correções pendentes a fazer depois. Pra
// reativar, troca pra true.
const MOSTRAR_NOVELUPDATES = false;

export function AtualizacoesPage() {
  const [sitesSuportados, setSitesSuportados] = useState<string[]>([]);
  const [matchAberto, setMatchAberto] = useState(false);

  useEffect(() => {
    supabase
      .from('sites_suportados')
      .select('nome')
      .eq('ativo', true)
      .then(({ data }) => setSitesSuportados((data ?? []).map((r) => r.nome as string)));
  }, []);

  return (
    <div className="atualizacao-massa">
      <h2>Updates</h2>

      <SecaoSitesSuportados sitesSuportados={sitesSuportados} />
      <SecaoNovasFontes sitesSuportados={sitesSuportados} />
      {MOSTRAR_NOVELUPDATES && <SecaoNovelUpdates />}

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

      <CsvBulkSection />
    </div>
  );
}
