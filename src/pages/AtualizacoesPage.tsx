import { useState, type ChangeEvent } from 'react';
import { db } from '../db/localDb';
import { updateObra } from '../db/repo';
import { buildUpdatePayload, parseCsvFile } from '../lib/csvBulkUpdate';
import { controlarScraper } from '../lib/scraperControl';
import { useScraperRun } from '../hooks/useScraperRun';
import { StatusExecucaoScraper } from '../components/StatusExecucaoScraper';
import { FontesPendentesLista } from '../components/FontesPendentesLista';

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

function SecaoCapitulos() {
  const { run, carregando, erro, recarregar } = useScraperRun('capitulos');
  const [acionando, setAcionando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  async function handleAtualizarAgora() {
    setAcionando(true);
    setErroAcao(null);
    try {
      await controlarScraper('capitulos', 'start');
      await recarregar();
    } catch (err) {
      setErroAcao(mensagemErroAcao(err));
    } finally {
      setAcionando(false);
    }
  }

  return (
    <section className="atualizacao-secao">
      <h3>Automatic update — Chapters</h3>
      <p>
        Every day a scheduled scraper visits each work's approved sources and updates the latest available chapter of
        each one. The "new chapter" flag in the list only shows up when that value was updated by the scraper — if you
        edit the chapter manually on a work's page, the flag disappears until the scraper confirms it again.
      </p>

      <div className="scraper-controles">
        <button type="button" onClick={handleAtualizarAgora} disabled={acionando}>
          {acionando ? 'Please wait…' : 'Update now'}
        </button>
        <button type="button" onClick={recarregar} className="atualizar-status">
          Refresh status
        </button>
      </div>
      <p className="execucao-nota">
        "Update now" runs an extra check without affecting the automatic daily schedule.
      </p>
      {erroAcao && <p className="execucao-status execucao-erro">{erroAcao}</p>}

      <StatusExecucaoScraper run={run} carregando={carregando} erro={erro} />
    </section>
  );
}

function SecaoObras() {
  const { run, carregando, erro, recarregar } = useScraperRun('obras');
  const [acionando, setAcionando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  async function handleAtualizar() {
    setAcionando(true);
    setErroAcao(null);
    try {
      await controlarScraper('obras', 'start');
      await recarregar();
    } catch (err) {
      setErroAcao(mensagemErroAcao(err));
    } finally {
      setAcionando(false);
    }
  }

  return (
    <section className="atualizacao-secao">
      <h3>Automatic update — Works</h3>
      <p>
        Scans each supported site's full catalog and links titles that match works you already track but don't have a
        source on that site yet — the opposite direction of "find new sources". Only nyxscans is mapped for now.
      </p>

      <div className="scraper-controles">
        <button type="button" onClick={handleAtualizar} disabled={acionando}>
          {acionando ? 'Please wait…' : 'Update works'}
        </button>
        <button type="button" onClick={recarregar} className="atualizar-status">
          Refresh status
        </button>
      </div>
      {erroAcao && <p className="execucao-status execucao-erro">{erroAcao}</p>}

      <StatusExecucaoScraper run={run} carregando={carregando} erro={erro} />
    </section>
  );
}

function SecaoFontes() {
  const { run, carregando, erro, recarregar } = useScraperRun('fontes');
  const [acionando, setAcionando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [mostrarPendentes, setMostrarPendentes] = useState(false);

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
      <h3>Automatic update — Sources</h3>
      <p>Finds new sources (sites) for works that don't have any yet, or new sites a work isn't using yet.</p>

      <div className="scraper-controles">
        <button type="button" onClick={handleAcao} disabled={acionando}>
          {acionando ? 'Please wait…' : rodando ? 'Stop search' : 'Start search'}
        </button>
        <button type="button" onClick={recarregar} className="atualizar-status">
          Refresh status
        </button>
      </div>
      {erroAcao && <p className="execucao-status execucao-erro">{erroAcao}</p>}

      <StatusExecucaoScraper run={run} carregando={carregando} erro={erro} />

      <button type="button" className="toggle-pendentes" onClick={() => setMostrarPendentes((v) => !v)}>
        {mostrarPendentes ? 'Hide' : 'Show'} pending sources
      </button>
      {mostrarPendentes && <FontesPendentesLista />}
    </section>
  );
}

export function AtualizacoesPage() {
  const [processando, setProcessando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

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

  return (
    <div className="atualizacao-massa">
      <h2>Updates</h2>

      <SecaoCapitulos />
      <SecaoObras />
      <SecaoFontes />

      <section className="atualizacao-secao">
        <h3>Bulk fill via CSV</h3>
        <p>
          Export the <code>obras</code> table from the Supabase Table Editor (Export data → CSV), fill in whatever
          fields you want in Excel/Google Sheets and upload the file here. Do not change the <code>id</code> and{' '}
          <code>titulo</code> columns. Empty cells keep the current value; in <code>generos</code>/<code>tags</code>,
          separate multiple values with <code>;</code>.
        </p>

        <label className="upload-csv">
          <input type="file" accept=".csv,text/csv" onChange={handleFile} disabled={processando} />
          {processando ? 'Processing…' : 'Choose CSV file'}
        </label>

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
