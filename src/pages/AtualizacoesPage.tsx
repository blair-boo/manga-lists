import { useEffect, useState } from 'react';
import { mensagemErroAcao } from '../lib/erros';
import { controlarScraper } from '../lib/scraperControl';
import { useSitesSuportados } from '../hooks/useSitesSuportados';
import { useNomesSitesAtivos } from '../hooks/useSitesAtivos';
import { ListaSitesSuportados, StatusAgregadoScraper } from '../components/ListaSitesSuportados';
import { CsvBulkSection } from '../components/CsvBulkSection';
import { ConciliacaoSitesSection } from '../components/ConciliacaoSitesSection';
import { PendingApprovalsBar } from '../components/PendingApprovalsBar';
import { FilaTipoDivergente } from '../components/FilaTipoDivergente';
import { SecaoNovelUpdates } from '../components/SecaoNovelUpdates';
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

function SecaoSitesSuportados() {
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
    </section>
  );
}

// Oculta a seção de Novel Updates na tela (não remove a funcionalidade — só a
// renderização): o scraper de NU tem correções pendentes a fazer depois. Pra
// reativar, troca pra true.
const MOSTRAR_NOVELUPDATES = false;

export function AtualizacoesPage() {
  const sitesSuportados = useNomesSitesAtivos();

  return (
    <div className="atualizacao-massa">
      <h2>Updates</h2>

      <PendingApprovalsBar sitesSuportados={sitesSuportados} />

      <section className="atualizacao-secao">
        <h3>Source type mismatches</h3>
        <p>
          Sources whose detected type (manga/novel) no longer matches the work they're attached to — happens when a
          type gets corrected manually. Move each one to the corresponding work, create it if it doesn't exist yet,
          discard the source, or keep it as-is to decide later.
        </p>
        <FilaTipoDivergente />
      </section>

      <SecaoSitesSuportados />
      {MOSTRAR_NOVELUPDATES && <SecaoNovelUpdates />}

      <CsvBulkSection />
      <ConciliacaoSitesSection />
    </div>
  );
}
