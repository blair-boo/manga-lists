import { useState, type ChangeEvent } from 'react';
import { db } from '../db/localDb';
import { updateObra } from '../db/repo';
import { supabase } from '../lib/supabaseClient';
import { mensagemDeErro } from '../lib/erros';
import { baixarCsv, buildUpdatePayload, obrasParaCsv, parseCsvFile } from '../lib/csvBulkUpdate';
import type { Obra } from '../types';

interface Resultado {
  atualizadas: number;
  semMudanca: number;
  naoEncontradas: string[];
  semId: number;
}

/** Seção "Bulk fill via CSV" da página de Updates: upload, download e resultado. */
export function CsvBulkSection() {
  const [processando, setProcessando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [baixando, setBaixando] = useState(false);
  const [erroDownload, setErroDownload] = useState<string | null>(null);

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
        <code>titulo</code> columns. Every column present in the file is written back, so an empty cell{' '}
        <strong>clears</strong> that field (a column left out of the file entirely is not touched); in{' '}
        <code>generos</code>/<code>tags</code>, separate multiple values with <code>;</code>.
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
          <p>{resultado.semMudanca} row(s) with no updatable column (ignored).</p>
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
  );
}
