import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { mensagemErroAcao } from '../lib/erros';
import { controlarScraper } from '../lib/scraperControl';
import { useScraperRun } from '../hooks/useScraperRun';
import { useSitesSuportados } from '../hooks/useSitesSuportados';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { StatusExecucaoScraper } from '../components/StatusExecucaoScraper';
import { ListaSitesSuportados, StatusAgregadoScraper } from '../components/ListaSitesSuportados';
import { DominiosSemAdaptador } from '../components/DominiosSemAdaptador';
import { AprovacaoDominios } from '../components/AprovacaoDominios';
import { AdicionarDominioManual } from '../components/AdicionarDominioManual';
import { CsvBulkSection } from '../components/CsvBulkSection';
import { FilaAprovacoes } from '../components/FilaAprovacoes';
import { SecaoNovelUpdates } from '../components/SecaoNovelUpdates';
import { ConfigMatchTitulo } from '../components/ConfigMatchTitulo';
import type { ScraperTipo } from '../types';

/** Data/hora local de conclusão da run, ou vazio. */
function formatarFinalizacao(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
}

// Failsafe: se a run disparada não aparecer como 'rodando' no banco nesse tempo
// (ex.: o runner demorou demais, ou terminou entre dois refreshes), solta o
// botão mesmo assim, pra não travar pra sempre.
const PENDENTE_MAX_MS = 3 * 60 * 1000;
const POLL_MS = 8000;

function SecaoSitesSuportados({ sitesSuportados }: { sitesSuportados: string[] }) {
  const sitesInfo = useSitesSuportados();
  const [acionando, setAcionando] = useState<ScraperTipo | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  // Momento em que cada tipo foi disparado, enquanto a run ainda não registrou
  // como 'rodando' no banco. Mantém o botão travado no intervalo entre o
  // dispatch do workflow e a primeira run aparecer (o runner leva uns segundos).
  const [pendenteCapitulos, setPendenteCapitulos] = useState<number | null>(null);
  const [pendenteObras, setPendenteObras] = useState<number | null>(null);

  const { recarregar, statusCapitulos, statusObras } = sitesInfo;
  const rodandoCapitulos = statusCapitulos === 'rodando';
  const rodandoObras = statusObras === 'rodando';

  // Assim que a run aparece como 'rodando', tira o tipo de "pendente" — daí em
  // diante o status real do banco é que trava/solta o botão.
  useEffect(() => {
    if (rodandoCapitulos) setPendenteCapitulos(null);
  }, [rodandoCapitulos]);
  useEffect(() => {
    if (rodandoObras) setPendenteObras(null);
  }, [rodandoObras]);

  const capitulosTravado = acionando !== null || rodandoCapitulos || pendenteCapitulos !== null;
  const obrasTravado = acionando !== null || rodandoObras || pendenteObras !== null;

  // Enquanto houver run em andamento (ou recém-disparada), refaz o fetch em
  // intervalo pra o status e os botões virarem sozinhos quando terminar, sem
  // precisar recarregar a página. Também aplica o failsafe dos "pendentes".
  const monitorando = rodandoCapitulos || rodandoObras || pendenteCapitulos !== null || pendenteObras !== null;
  useEffect(() => {
    if (!monitorando) return;
    const id = window.setInterval(() => {
      void recarregar();
      const agora = Date.now();
      setPendenteCapitulos((t) => (t !== null && agora - t > PENDENTE_MAX_MS ? null : t));
      setPendenteObras((t) => (t !== null && agora - t > PENDENTE_MAX_MS ? null : t));
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [monitorando, recarregar]);

  async function disparar(tipo: ScraperTipo) {
    setAcionando(tipo);
    setErroAcao(null);
    try {
      await controlarScraper(tipo, 'start');
      if (tipo === 'capitulos') setPendenteCapitulos(Date.now());
      if (tipo === 'obras') setPendenteObras(Date.now());
      await recarregar();
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
        <button type="button" onClick={() => disparar('capitulos')} disabled={capitulosTravado}>
          {acionando === 'capitulos'
            ? 'Please wait…'
            : rodandoCapitulos || pendenteCapitulos !== null
              ? 'In progress…'
              : 'Update chapters'}
        </button>
        <button type="button" onClick={() => disparar('obras')} disabled={obrasTravado}>
          {acionando === 'obras'
            ? 'Please wait…'
            : rodandoObras || pendenteObras !== null
              ? 'In progress…'
              : 'Update works'}
        </button>
      </div>
      {erroAcao && <p className="execucao-status execucao-erro">{erroAcao}</p>}

      <h4 className="atualizacao-subtitulo">Latest run</h4>
      <div className="latest-run-grupo">
        <div className="latest-run-item">
          <span className="latest-run-rotulo">Works</span>
          <StatusAgregadoScraper status={sitesInfo.statusObras} carregando={sitesInfo.carregando} erro={sitesInfo.erro} />
          {sitesInfo.finalizadoObras && (
            <span className="latest-run-data">Finished {formatarFinalizacao(sitesInfo.finalizadoObras)}</span>
          )}
        </div>
        <div className="latest-run-item">
          <span className="latest-run-rotulo">Chapters</span>
          <StatusAgregadoScraper
            status={sitesInfo.statusCapitulos}
            carregando={sitesInfo.carregando}
            erro={sitesInfo.erro}
          />
          {sitesInfo.finalizadoCapitulos && (
            <span className="latest-run-data">Finished {formatarFinalizacao(sitesInfo.finalizadoCapitulos)}</span>
          )}
        </div>
      </div>

      <ListaSitesSuportados sites={sitesInfo.sites} carregando={sitesInfo.carregando} erro={sitesInfo.erro} />

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
