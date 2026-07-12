import { useState, type ChangeEvent } from 'react';
import { db } from '../db/localDb';
import { updateObra } from '../db/repo';
import { buildUpdatePayload, parseCsvFile } from '../lib/csvBulkUpdate';

interface Resultado {
  atualizadas: number;
  semMudanca: number;
  naoEncontradas: string[];
  semId: number;
}

export function AtualizacaoMassaPage() {
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
      <h2>Atualização em massa</h2>
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
    </div>
  );
}
