import { useEffect, useState } from 'react';
import { mensagemErroAcao } from '../lib/erros';
import { controlarScraper } from '../lib/scraperControl';
import { useSitesSuportados } from '../hooks/useSitesSuportados';
import type { StatusAgregadoRun } from '../hooks/useSitesSuportados';
import { useNomesSitesAtivos } from '../hooks/useSitesAtivos';
import { ListaSitesSuportados, StatusAgregadoScraper } from '../components/ListaSitesSuportados';
import { CsvBulkSection } from '../components/CsvBulkSection';
import { ConciliacaoSitesSection } from '../components/ConciliacaoSitesSection';
import { PendingApprovalsBar } from '../components/PendingApprovalsBar';
import { AlertaScrapingApi } from '../components/AlertaScrapingApi';
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

/**
 * Um scraper, um bloco: botão, erro e "Latest run" próprios.
 *
 * Cada instância é dona do seu estado (`acionando`, `pendente`, `erroAcao`) e
 * só dispara o `tipo` que recebeu por prop. Isso é o que garante a separação
 * pedida: como não existe estado compartilhado entre as instâncias, clicar em
 * "Update chapters" não tem por onde mexer no bloco de "Update works" — nem
 * travar o botão, nem herdar mensagem de erro, nem disparar o outro workflow.
 * (Os dois workflows do GitHub Actions e os dois scripts Python já eram
 * independentes; o que era compartilhado morava só aqui na UI.)
 */
function BlocoScraper({
  tipo,
  titulo,
  descricao,
  rotuloBotao,
  status,
  finalizadoEm,
  carregando,
  erro,
  recarregar,
}: {
  tipo: ScraperTipo;
  titulo: string;
  descricao: string;
  rotuloBotao: string;
  status: StatusAgregadoRun;
  finalizadoEm: string | null;
  carregando: boolean;
  erro: string | null;
  recarregar: () => Promise<void>;
}) {
  const [acionando, setAcionando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  // Momento do disparo, enquanto a run ainda não registrou como 'rodando' no
  // banco. Mantém o botão travado no intervalo entre o dispatch do workflow e
  // a primeira run aparecer (o runner leva uns segundos).
  const [pendente, setPendente] = useState<number | null>(null);

  const rodando = status === 'rodando';

  // Assim que a run aparece como 'rodando', tira o "pendente" — daí em diante
  // o status real do banco é que trava/solta o botão.
  useEffect(() => {
    if (rodando) setPendente(null);
  }, [rodando]);

  // Enquanto ESTE scraper roda (ou acabou de ser disparado), refaz o fetch em
  // intervalo pro status e o botão virarem sozinhos quando terminar, sem
  // recarregar a página. Também aplica o failsafe do "pendente".
  const monitorando = rodando || pendente !== null;
  useEffect(() => {
    if (!monitorando) return;
    const id = window.setInterval(() => {
      void recarregar();
      setPendente((t) => (t !== null && Date.now() - t > PENDENTE_MAX_MS ? null : t));
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [monitorando, recarregar]);

  const travado = acionando || rodando || pendente !== null;

  async function disparar() {
    setAcionando(true);
    setErroAcao(null);
    try {
      await controlarScraper(tipo, 'start');
      setPendente(Date.now());
      await recarregar();
    } catch (err) {
      setErroAcao(mensagemErroAcao(err));
    } finally {
      setAcionando(false);
    }
  }

  return (
    <div className="scraper-bloco">
      <h4 className="atualizacao-subtitulo">{titulo}</h4>
      <p className="atualizacao-subtitulo-nota">{descricao}</p>

      <div className="scraper-controles">
        <button type="button" onClick={() => void disparar()} disabled={travado}>
          {acionando ? 'Please wait…' : rodando || pendente !== null ? 'In progress…' : rotuloBotao}
        </button>
      </div>

      {erroAcao && <p className="execucao-status execucao-erro">{erroAcao}</p>}

      <div className="latest-run-item">
        <span className="latest-run-rotulo">Latest run</span>
        <StatusAgregadoScraper status={status} carregando={carregando} erro={erro} />
        {finalizadoEm && <span className="latest-run-data">Finished {formatarFinalizacao(finalizadoEm)}</span>}
      </div>
    </div>
  );
}

/**
 * "Supported sites": dois scrapers independentes, um bloco cada, e a tabela de
 * domínios embaixo (relatório só-leitura, com uma coluna por scraper).
 *
 * Nada de estado compartilhado entre os dois blocos — ver BlocoScraper.
 */
function SecaoSitesSuportados() {
  const sitesInfo = useSitesSuportados();
  const { recarregar, statusCapitulos, statusObras, carregando, erro } = sitesInfo;

  return (
    <section className="atualizacao-secao">
      <h3>Supported sites</h3>

      <div className="scraper-blocos">
        <BlocoScraper
          tipo="capitulos"
          titulo="Chapters"
          descricao="Check your approved sources and update each work's latest released chapter."
          rotuloBotao="Update chapters"
          status={statusCapitulos}
          finalizadoEm={sitesInfo.finalizadoCapitulos}
          carregando={carregando}
          erro={erro}
          recarregar={recarregar}
        />

        <BlocoScraper
          tipo="obras"
          titulo="Works"
          descricao="Scan supported sites' catalogs to link works you already track but don't have a source on that site yet."
          rotuloBotao="Update works"
          status={statusObras}
          finalizadoEm={sitesInfo.finalizadoObras}
          carregando={carregando}
          erro={erro}
          recarregar={recarregar}
        />
      </div>

      <ListaSitesSuportados sites={sitesInfo.sites} carregando={carregando} erro={erro} />
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

      <AlertaScrapingApi />
      <PendingApprovalsBar sitesSuportados={sitesSuportados} />

      <SecaoSitesSuportados />
      {MOSTRAR_NOVELUPDATES && <SecaoNovelUpdates />}

      <CsvBulkSection />
      <ConciliacaoSitesSection />
    </div>
  );
}
