import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { db } from '../db/localDb';
import { updateObra } from '../db/repo';
import { supabase } from '../lib/supabaseClient';
import { baixarCsv, buildUpdatePayload, obrasParaCsv, parseCsvFile } from '../lib/csvBulkUpdate';
import { controlarScraper } from '../lib/scraperControl';
import { adicionarDominioSeguro } from '../lib/scraperConfig';
import { useScraperRun } from '../hooks/useScraperRun';
import { StatusExecucaoScraper } from '../components/StatusExecucaoScraper';
import { ListaSitesSuportados } from '../components/ListaSitesSuportados';
import { DominiosSemAdaptador } from '../components/DominiosSemAdaptador';
import { AprovacaoDominios } from '../components/AprovacaoDominios';
import { FilaAprovacoes } from '../components/FilaAprovacoes';
import { ConfigMatchTitulo } from '../components/ConfigMatchTitulo';
import type { Obra, ScraperTipo } from '../types';

interface Resultado {
  atualizadas: number;
  semMudanca: number;
  naoEncontradas: string[];
  semId: number;
}

function mensagemErroAcao(err: unknown): string {
  const detalhe = err instanceof Error ? err.message : String(err);
  return `Could not reach the scraper control (${detalhe}). Check that the "scraper-control" Edge Function is deployed and that the GH_ACTIONS_TOKEN secret is set.`;
}

const MENSAGEM_RESULTADO_DOMINIO: Record<string, string> = {
  ja_aprovado: 'Already an approved domain — nothing to do.',
  ativado: 'Domain reactivated and approved.',
  criado: 'Domain added and approved.',
};

/** Inserção manual de domínio seguro direto na página de Updates (handout consolidado C5). */
function AdicionarDominioManual() {
  const [valor, setValor] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const entrada = valor.trim();
    if (!entrada) return;
    setEnviando(true);
    setErro(null);
    setMensagem(null);
    try {
      const resultado = await adicionarDominioSeguro(entrada);
      setMensagem(MENSAGEM_RESULTADO_DOMINIO[resultado]);
      setValor('');
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="adicionar-dominio-form" onSubmit={handleSubmit}>
      <input
        type="text"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder="domain.com or https://domain.com/…"
        disabled={enviando}
      />
      <button type="submit" disabled={enviando || !valor.trim()}>
        {enviando ? 'Please wait…' : 'Add safe domain'}
      </button>
      {mensagem && (
        <p className="execucao-status execucao-ok">
          <strong>{mensagem}</strong>
        </p>
      )}
      {erro && <p className="execucao-status execucao-erro">{erro}</p>}
    </form>
  );
}

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

      <h4 className="atualizacao-subtitulo">Works — by site</h4>
      <ListaSitesSuportados />

      <h4 className="atualizacao-subtitulo">Domain approvals</h4>
      <p className="atualizacao-subtitulo-nota">
        A source you add manually is saved right away, but its domain only gets scraped automatically once approved
        here. You can also add a known-safe domain directly, without adding a source first — this also reactivates a
        previously rejected domain.
      </p>
      <AdicionarDominioManual />
      <AprovacaoDominios />

      <h4 className="atualizacao-subtitulo">Domains without adapter</h4>
      <DominiosSemAdaptador />

      <FilaAprovacoes titulo="Approvals" escopo="suportados" sitesSuportados={sitesSuportados} />
    </section>
  );
}

function SecaoNovasFontes({ sitesSuportados }: { sitesSuportados: string[] }) {
  const { run, carregando, erro, recarregar } = useScraperRun('fontes');
  const [acionando, setAcionando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const rodando = run?.status === 'rodando';

  async function handleAcao() {
    setAcionando(true);
    setErroAcao(null);
    try {
      await controlarScraper('fontes', rodando ? 'stop' : 'start');
      await recarregar();
    } catch (err) {
      setErroAcao(mensagemErroAcao(err));
    } finally {
      setAcionando(false);
    }
  }

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

export function AtualizacoesPage() {
  const [sitesSuportados, setSitesSuportados] = useState<string[]>([]);
  const [processando, setProcessando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [matchAberto, setMatchAberto] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const [erroDownload, setErroDownload] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('sites_suportados')
      .select('nome')
      .eq('ativo', true)
      .then(({ data }) => setSitesSuportados((data ?? []).map((r) => r.nome as string)));
  }, []);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setProcessando(true);
    setResultado(null);

    const texto = await file.text();
    const linhas = parseCsvFile(texto);

    let atualizadas = 0;
    let semMudanca = 0;
    let semId = 0;
    const naoEncontradas: string[] = [];

    for (const linha of linhas) {
      const id = (linha.id ?? '').trim();
      if (!id) {
        semId++;
        continue;
      }

      const existente = await db.obras.get(id);
      if (!existente) {
        naoEncontradas.push(linha.titulo || id);
        continue;
      }

      const payload = buildUpdatePayload(linha);
      if (Object.keys(payload).length === 0) {
        semMudanca++;
        continue;
      }

      await updateObra(id, payload);
      atualizadas++;
    }

    setResultado({ atualizadas, semMudanca, naoEncontradas, semId });
    setProcessando(false);
  }

  async function handleDownload() {
    setBaixando(true);
    setErroDownload(null);
    try {
      const { data, error } = await supabase.from('obras').select('*');
      if (error) throw error;
      baixarCsv(obrasParaCsv((data ?? []) as Obra[]), 'obras.csv');
    } catch (err) {
      setErroDownload(err instanceof Error ? err.message : String(err));
    } finally {
      setBaixando(false);
    }
  }

  return (
    <div className="atualizacao-massa">
      <h2>Updates</h2>

      <SecaoSitesSuportados sitesSuportados={sitesSuportados} />
      <SecaoNovasFontes sitesSuportados={sitesSuportados} />

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

      <section className="atualizacao-secao">
        <h3>Bulk fill via CSV</h3>
        <p>
          Export the <code>obras</code> table (button below, or from the Supabase Table Editor), fill in whatever
          fields you want in Excel/Google Sheets and upload the file here. Do not change the <code>id</code> and{' '}
          <code>titulo</code> columns. Empty cells keep the current value; in <code>generos</code>/<code>tags</code>,
          separate multiple values with <code>;</code>.
        </p>

        <div className="csv-acoes">
          <label className="upload-csv">
            <input type="file" accept=".csv,text/csv" onChange={handleFile} disabled={processando} />
            {processando ? 'Processing…' : 'Choose CSV file'}
          </label>
          <button type="button" className="botao-secundario" onClick={handleDownload} disabled={baixando}>
            {baixando ? 'Please wait…' : 'Download current CSV'}
          </button>
        </div>
        {erroDownload && <p className="execucao-status execucao-erro">{erroDownload}</p>}

        {resultado && (
          <div className="atualizacao-massa-resultado">
            <p>{resultado.atualizadas} work(s) updated.</p>
            <p>{resultado.semMudanca} row(s) with no field filled (ignored).</p>
            {resultado.semId > 0 && <p>{resultado.semId} row(s) without an id column (ignored).</p>}
            {resultado.naoEncontradas.length > 0 && (
              <div>
                <p>Not found locally (sync and try again):</p>
                <ul>
                  {resultado.naoEncontradas.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
