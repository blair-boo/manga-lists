import { useState, type ChangeEvent } from 'react';
import { db } from '../db/localDb';
import { createFonte, deleteFonte, updateObra } from '../db/repo';
import { syncNow } from '../sync/sync';
import { supabase } from '../lib/supabaseClient';
import { mensagemDeErro } from '../lib/erros';
import { deriveSite } from '../lib/site';
import { familiaDeTipo } from '../lib/obra';
import { useDialogos } from './Dialogo';
import { StatusImportacaoView } from './StatusImportacaoView';
import {
  ROTULO_TIPO,
  bloqueiaImportacao,
  salvarStatusImportacao,
  useStatusImportacao,
  type StatusImportacao,
} from '../lib/importStatus';
import {
  baixarCsv,
  buildUpdatePayload,
  obrasParaCsv,
  parseCsvFile,
  sourcesDaLinha,
  type ModoImportacaoCsv,
} from '../lib/csvBulkUpdate';
import type { Fonte, Obra } from '../types';

/** "obras_2026-08-11_14-32.csv" — data/hora local no nome, sem `:` (inválido em nomes de arquivo no Windows). */
function nomeArquivoComDataHora(base: string): string {
  const agora = new Date();
  const par = (n: number) => String(n).padStart(2, '0');
  const data = `${agora.getFullYear()}-${par(agora.getMonth() + 1)}-${par(agora.getDate())}`;
  const hora = `${par(agora.getHours())}-${par(agora.getMinutes())}`;
  return `${base}_${data}_${hora}.csv`;
}

const MODOS: { valor: ModoImportacaoCsv; rotulo: string; descricao: string }[] = [
  {
    valor: 'complementar',
    rotulo: 'Merge (non-destructive)',
    descricao:
      'a blank cell leaves the field untouched; genres/tags/alternative titles and sources only get new values added, nothing is ever removed.',
  },
  {
    valor: 'sobrescrever',
    rotulo: 'Overwrite',
    descricao: 'a blank cell clears the field; sources not listed in the "sources" column are removed.',
  },
];

interface Resultado {
  atualizadas: number;
  semMudanca: number;
  naoEncontradas: string[];
  semId: number;
  linhasComProblema: number;
  fontesAdicionadas: number;
  fontesRemovidas: number;
  erroSync: string | null;
}

/**
 * Reconcilia as fontes da obra contra a lista de URLs desejada (coluna
 * `sources`): cria as que faltam, preserva sem tocar as que já batem (mantém
 * capítulo detectado, tipo, ordem etc. — só a URL casa). Em modo
 * 'sobrescrever' também apaga as fontes que não estão mais na lista; em modo
 * 'complementar' (Modo 2) nunca remove, só soma.
 */
async function reconciliarFontes(
  obra: Obra,
  urlsDesejadas: string[],
  modo: ModoImportacaoCsv
): Promise<{ criadas: number; removidas: number }> {
  const atuais = await db.fontes.where('obra_id').equals(obra.id).toArray();
  const desejadasSet = new Set(urlsDesejadas);
  const atuaisPorUrl = new Map(atuais.map((f) => [f.url, f]));

  const paraRemover = modo === 'sobrescrever' ? atuais.filter((f) => !desejadasSet.has(f.url)) : [];
  const paraCriar = urlsDesejadas.filter((url) => !atuaisPorUrl.has(url));

  for (const f of paraRemover) await deleteFonte(f.id);

  let maiorOrdem = atuais.reduce((max, f) => (f.ordem != null && f.ordem > max ? f.ordem : max), -1);
  for (const url of paraCriar) {
    maiorOrdem++;
    await createFonte({
      obra_id: obra.id,
      site: deriveSite(url),
      url,
      ultimo_capitulo_detectado: null,
      atualizado_por_scraper: false,
      confiavel: true,
      status_aprovacao: 'aprovado',
      descoberta_automaticamente: false,
      ultima_verificacao: null,
      tipo_detectado: familiaDeTipo(obra.tipo),
      tipo_manual: false,
      ordem: maiorOrdem,
    });
  }

  return { criadas: paraCriar.length, removidas: paraRemover.length };
}

/** Seção "Bulk fill via CSV" da página de Updates: upload, download e resultado. */
export function CsvBulkSection() {
  const { confirmar } = useDialogos();
  const [modo, setModo] = useState<ModoImportacaoCsv>('complementar');
  const [processando, setProcessando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [baixando, setBaixando] = useState(false);
  const [erroDownload, setErroDownload] = useState<string | null>(null);

  const statusImportacao = useStatusImportacao();
  const bloqueio = bloqueiaImportacao(statusImportacao);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || bloqueio) return;

    // Modo Overwrite é destrutivo (célula vazia limpa, sources fora da lista
    // somem) — confirma antes de rodar. Merge é seguro por definição, sem
    // confirmação (suave demais pra travar o fluxo comum).
    if (modo === 'sobrescrever') {
      const ok = await confirmar({
        titulo: 'Overwrite import',
        mensagem:
          'Blank cells will clear fields, and any source not listed in the "sources" column will be removed. Continue?',
        confirmarRotulo: 'Continue',
        perigoso: true,
      });
      if (!ok) return;
    }

    setProcessando(true);
    setResultado(null);

    const texto = await file.text();
    const { linhas, linhasComProblema } = parseCsvFile(texto);

    // Trava compartilhada com Reconciliation (StatusImportacaoView/bloqueiaImportacao
    // lê o mesmo registro) — reduz o risco de as duas atualizarem obras/fontes ao
    // mesmo tempo, seja da mesma aba ou de outra aberta neste dispositivo.
    const statusBase: StatusImportacao = {
      tipo: 'csv',
      arquivo: file.name,
      iniciadoEm: new Date().toISOString(),
      total: linhas.length,
      feito: 0,
      concluidoEm: null,
      erro: null,
    };
    await salvarStatusImportacao(statusBase);

    let atualizadas = 0;
    let semMudanca = 0;
    let semId = 0;
    let fontesAdicionadas = 0;
    let fontesRemovidas = 0;
    const naoEncontradas: string[] = [];

    try {
      for (let i = 0; i < linhas.length; i++) {
        const linha = linhas[i];
        const id = (linha.id ?? '').trim();
        if (!id) {
          semId++;
        } else {
          const existente = await db.obras.get(id);
          if (!existente) {
            naoEncontradas.push(linha.titulo || id);
          } else {
            let mudou = false;

            const payload = buildUpdatePayload(linha, modo, existente);
            if (Object.keys(payload).length > 0) {
              await updateObra(id, payload);
              mudou = true;
            }

            const urlsDesejadas = sourcesDaLinha(linha);
            if (urlsDesejadas !== undefined) {
              const { criadas, removidas } = await reconciliarFontes(existente, urlsDesejadas, modo);
              fontesAdicionadas += criadas;
              fontesRemovidas += removidas;
              if (criadas > 0 || removidas > 0) mudou = true;
            }

            if (mudou) atualizadas++;
            else semMudanca++;
          }
        }
        await salvarStatusImportacao({ ...statusBase, feito: i + 1 });
      }

      // Espera o envio pro Supabase terminar (em vez de só confiar no disparo em
      // segundo plano de cada updateObra) pra reportar um resultado que reflete
      // o que realmente chegou no servidor, não só a escrita local. O sync
      // disparado pela PRIMEIRA linha do loop pode já estar em andamento antes
      // das linhas seguintes serem enfileiradas (corrida entre o disparo em
      // segundo plano e o loop sequencial) — se ainda sobrar mutação na fila
      // depois dessa espera, essa primeira sync só pegou parte do lote; roda de
      // novo (agora garantido sem sync concorrente) pra pegar o resto.
      let resultadoSync = atualizadas > 0 ? await syncNow() : { ok: true as const, error: undefined };
      if (atualizadas > 0 && (await db.syncQueue.count()) > 0) {
        resultadoSync = await syncNow();
      }

      setResultado({
        atualizadas,
        semMudanca,
        naoEncontradas,
        semId,
        linhasComProblema,
        fontesAdicionadas,
        fontesRemovidas,
        erroSync: resultadoSync.ok ? null : mensagemDeErro(resultadoSync.error),
      });
      await salvarStatusImportacao({
        ...statusBase,
        feito: linhas.length,
        concluidoEm: new Date().toISOString(),
        erro: resultadoSync.ok ? null : mensagemDeErro(resultadoSync.error),
      });
    } catch (err) {
      await salvarStatusImportacao({
        ...statusBase,
        concluidoEm: new Date().toISOString(),
        erro: mensagemDeErro(err),
      });
    } finally {
      setProcessando(false);
    }
  }

  async function handleDownload() {
    setBaixando(true);
    setErroDownload(null);
    try {
      const [{ data: obras, error: erroObras }, { data: fontes, error: erroFontes }] = await Promise.all([
        supabase.from('obras').select('*'),
        supabase.from('fontes').select('*'),
      ]);
      if (erroObras) throw erroObras;
      if (erroFontes) throw erroFontes;
      const fontesPorObra = new Map<string, Fonte[]>();
      for (const f of (fontes ?? []) as Fonte[]) {
        const lista = fontesPorObra.get(f.obra_id) ?? [];
        lista.push(f);
        fontesPorObra.set(f.obra_id, lista);
      }
      baixarCsv(obrasParaCsv((obras ?? []) as Obra[], fontesPorObra), nomeArquivoComDataHora('obras'));
    } catch (err) {
      setErroDownload(mensagemDeErro(err));
    } finally {
      setBaixando(false);
    }
  }

  return (
    <section className="atualizacao-secao">
      <h3>Bulk fill via CSV</h3>
      <p>
        Export the <code>obras</code> table (button below, or from the Supabase Table Editor), fill in whatever
        fields you want in Excel/Google Sheets and upload the file here. Do not change the <code>id</code> and{' '}
        <code>titulo</code> columns. A column left out of the file entirely is never touched; in{' '}
        <code>generos</code>/<code>tags</code>/<code>titulos_alternativos</code>/<code>sources</code>, separate
        multiple values with <code>;</code>. <code>criado_em</code>/<code>atualizado_em</code> (and any other column
        outside the ones listed in the downloaded CSV, like <code>obra_vinculada_id</code>) are always ignored — but
        if you exported straight from the Table Editor, deleting those two date columns before editing/saving is a
        good idea anyway: spreadsheet apps sometimes reformat them with an unquoted comma, which shifts the rest of
        that row's columns and gets flagged below.
      </p>

      <div className="conciliacao-tipos">
        {MODOS.map((m) => (
          <label key={m.valor} className="conciliacao-tipo-opcao">
            <input type="radio" name="csv-modo" value={m.valor} checked={modo === m.valor} onChange={() => setModo(m.valor)} />
            {m.rotulo}
          </label>
        ))}
      </div>
      <p className="atualizacao-subtitulo-nota">
        {MODOS.find((m) => m.valor === modo)?.descricao} Same rule for the <code>sources</code> column
        (edits the <code>fontes</code> table): URLs you leave in place always keep their detected chapter/type/order
        untouched, only the URL itself is matched.
      </p>

      <div className="csv-acoes">
        <label className="upload-csv">
          <input type="file" accept=".csv,text/csv" onChange={handleFile} disabled={processando || !!bloqueio} />
          {processando ? 'Processing…' : 'Choose CSV file'}
        </label>
        <button type="button" className="botao-secundario" onClick={handleDownload} disabled={baixando}>
          {baixando ? 'Please wait…' : 'Download current CSV'}
        </button>
      </div>
      {erroDownload && <p className="execucao-status execucao-erro">{erroDownload}</p>}
      {bloqueio && (
        <p className="execucao-status execucao-erro">
          Another import ({ROTULO_TIPO[bloqueio.tipo]} — {bloqueio.arquivo}) is in progress. Wait for it to finish
          before starting this one.
        </p>
      )}
      <StatusImportacaoView status={statusImportacao} />

      {resultado && (
        <div className="atualizacao-massa-resultado">
          <p>{resultado.atualizadas} work(s) updated{resultado.erroSync ? ' locally' : ' and sent to the server'}.</p>
          {resultado.erroSync && (
            <p className="execucao-status execucao-erro">
              Some changes could not reach the server yet ({resultado.erroSync}). They're saved on this device and
              will retry automatically — check the sync status in the header.
            </p>
          )}
          <p>{resultado.semMudanca} row(s) with no updatable column (ignored).</p>
          {resultado.semId > 0 && <p>{resultado.semId} row(s) without an id column (ignored).</p>}
          {(resultado.fontesAdicionadas > 0 || resultado.fontesRemovidas > 0) && (
            <p>
              Sources: {resultado.fontesAdicionadas} added, {resultado.fontesRemovidas} removed.
            </p>
          )}
          {resultado.linhasComProblema > 0 && (
            <p className="execucao-status execucao-erro">
              {resultado.linhasComProblema} row(s) had misaligned CSV columns (likely an unquoted comma from a
              reformatted date) — those rows may be missing fields. Try removing <code>criado_em</code>/
              <code>atualizado_em</code> from the file and re-uploading.
            </p>
          )}
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
  );
}
