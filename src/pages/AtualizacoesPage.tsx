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
  return `Não consegui falar com o controle do scraper (${detalhe}). Verifique se a Edge Function "scraper-control" já foi publicada e se o secret GH_ACTIONS_TOKEN está configurado.`;
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
      <h3>Atualização automática — Capítulos</h3>
      <p>
        Todo dia, um scraper agendado visita as fontes já aprovadas de cada obra e atualiza o último capítulo
        disponível de cada uma. O aviso de "novo capítulo" na lista só aparece quando esse valor foi atualizado por
        ele — se você editar o capítulo manualmente na página da obra, o aviso some até o scraper confirmar de novo.
      </p>

      <div className="scraper-controles">
        <button type="button" onClick={handleAtualizarAgora} disabled={acionando}>
          {acionando ? 'Aguarde…' : 'Atualizar agora'}
        </button>
        <button type="button" onClick={recarregar} className="atualizar-status">
          Atualizar status
        </button>
      </div>
      <p className="execucao-nota">
        "Atualizar agora" roda uma verificação extra, sem afetar o agendamento diário automático.
      </p>
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
      <h3>Atualização automática — Fontes</h3>
      <p>Busca novas fontes (sites) pra obras que ainda não têm, ou pra sites novos que uma obra ainda não usa.</p>

      <div className="scraper-controles">
        <button type="button" onClick={handleAcao} disabled={acionando}>
          {acionando ? 'Aguarde…' : rodando ? 'Parar busca' : 'Iniciar busca'}
        </button>
        <button type="button" onClick={recarregar} className="atualizar-status">
          Atualizar status
        </button>
      </div>
      {erroAcao && <p className="execucao-status execucao-erro">{erroAcao}</p>}

      <StatusExecucaoScraper run={run} carregando={carregando} erro={erro} />

      <button type="button" className="toggle-pendentes" onClick={() => setMostrarPendentes((v) => !v)}>
        {mostrarPendentes ? 'Ocultar' : 'Mostrar'} fontes pendentes
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
      <h2>Atualizações</h2>

      <SecaoCapitulos />
      <SecaoFontes />

      <section className="atualizacao-secao">
        <h3>Preenchimento em massa via CSV</h3>
        <p>
          Exporte a tabela <code>obras</code> pelo Table Editor do Supabase (Export data → CSV), preencha os campos
          que quiser no Excel/Google Sheets e envie o arquivo aqui. Não altere as colunas <code>id</code> e{' '}
          <code>titulo</code>. Células vazias mantêm o valor atual; em <code>generos</code>/<code>tags</code>, separe
          múltiplos valores com <code>;</code>.
        </p>

        <label className="upload-csv">
          <input type="file" accept=".csv,text/csv" onChange={handleFile} disabled={processando} />
          {processando ? 'Processando…' : 'Escolher arquivo CSV'}
        </label>

        {resultado && (
          <div className="atualizacao-massa-resultado">
            <p>{resultado.atualizadas} obra(s) atualizada(s).</p>
            <p>{resultado.semMudanca} linha(s) sem nenhum campo preenchido (ignoradas).</p>
            {resultado.semId > 0 && <p>{resultado.semId} linha(s) sem coluna id (ignoradas).</p>}
            {resultado.naoEncontradas.length > 0 && (
              <div>
                <p>Não encontradas localmente (sincronize e tente de novo):</p>
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
