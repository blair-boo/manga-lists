import Papa from 'papaparse';
import type { NovaObra } from '../db/repo';
import type { Obra } from '../types';

/**
 * Campos que a atualização em massa via CSV sabe ler/escrever, agrupados por
 * como o valor é convertido. `id`/`titulo` ficam de fora (são identificadores —
 * o texto de ajuda pede pra não mexer neles) e `obra_vinculada_id` também
 * (o vínculo é mútuo e mantido por vincularObras/desvincularObra; editar o id
 * cru pelo CSV quebraria a reciprocidade). Qualquer coluna nova da tabela
 * `obras` passa a ser atualizada só adicionando o nome no grupo certo aqui.
 */
const CAMPOS_TEXTO = [
  'tipo',
  'autor',
  'capa_url',
  'status_leitura',
  'status_publicacao',
  'observacoes',
  'classificacao',
  'novelupdates_url',
] as const;
const CAMPOS_NUMERO = ['capitulo_atual', 'nota', 'ultimo_capitulo_lancado'] as const;
const CAMPOS_ARRAY = ['generos', 'tags', 'titulos_alternativos'] as const;
const CAMPOS_BOOL = ['fim_de_temporada', 'ultimo_capitulo_via_scraper', 'pdf'] as const;

/** Ordem/colunas exatas do CSV baixado (id/titulo + os quatro grupos acima). */
const COLUNAS_CSV = [
  'id',
  'titulo',
  ...CAMPOS_TEXTO,
  ...CAMPOS_NUMERO,
  ...CAMPOS_ARRAY,
  ...CAMPOS_BOOL,
] as const;

const VALORES_BOOL_VERDADEIRO = new Set(['true', 't', '1', 'yes', 'y', 'sim', 's', 'x', 'verdadeiro']);

function parseArrayCampo(valor: string | undefined): string[] {
  const v = (valor ?? '').trim();
  if (!v) return [];
  if (v.startsWith('{') && v.endsWith('}')) {
    const inner = v.slice(1, -1).trim();
    return inner ? inner.split(',').map((s) => s.trim()) : [];
  }
  if (v.startsWith('[') && v.endsWith(']')) {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // cai pro parser de ; abaixo
    }
  }
  return v
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface LinhaCsv {
  id?: string;
  titulo?: string;
  [key: string]: string | undefined;
}

/**
 * Monta o patch a partir de uma linha do CSV. Regra de presença:
 * - coluna AUSENTE do CSV (nem no cabeçalho) → não entra no payload (não mexe);
 * - coluna PRESENTE porém vazia → limpa o campo (null, ou false pros booleanos);
 * - coluna PRESENTE com valor → grava o valor convertido.
 * Número inválido (ex.: "abc") é a única exceção: ignora a célula em vez de
 * limpar, pra não zerar um valor por causa de erro de digitação.
 */
export function buildUpdatePayload(row: LinhaCsv): Partial<NovaObra> {
  const payload: Partial<NovaObra> = {};

  for (const campo of CAMPOS_TEXTO) {
    if (!(campo in row)) continue;
    const v = (row[campo] ?? '').trim();
    payload[campo] = (v || null) as never;
  }

  for (const campo of CAMPOS_NUMERO) {
    if (!(campo in row)) continue;
    const v = (row[campo] ?? '').trim();
    if (!v) {
      payload[campo] = null as never;
      continue;
    }
    const n = Number(v);
    if (!Number.isNaN(n)) payload[campo] = n as never;
  }

  for (const campo of CAMPOS_ARRAY) {
    if (!(campo in row)) continue;
    const arr = parseArrayCampo(row[campo]);
    payload[campo] = (arr.length > 0 ? arr : null) as never;
  }

  for (const campo of CAMPOS_BOOL) {
    if (!(campo in row)) continue;
    const v = (row[campo] ?? '').trim().toLowerCase();
    payload[campo] = VALORES_BOOL_VERDADEIRO.has(v) as never;
  }

  return payload;
}

export function parseCsvFile(texto: string): LinhaCsv[] {
  const resultado = Papa.parse<LinhaCsv>(texto, { header: true, skipEmptyLines: true });
  return resultado.data;
}

/**
 * Gera o CSV da tabela `obras` no mesmo formato que a atualização em massa
 * espera de volta (mesmas colunas/ordem; arrays com `;`, booleanos como
 * true/false) — download → editar → re-upload sem conversão manual.
 */
export function obrasParaCsv(obras: Obra[]): string {
  const linhas = obras.map((o) => {
    const linha: Record<string, string> = { id: o.id, titulo: o.titulo };
    for (const campo of CAMPOS_TEXTO) linha[campo] = (o[campo] as string | null) ?? '';
    for (const campo of CAMPOS_NUMERO) linha[campo] = o[campo] != null ? String(o[campo]) : '';
    for (const campo of CAMPOS_ARRAY) linha[campo] = (o[campo] ?? []).join('; ');
    for (const campo of CAMPOS_BOOL) linha[campo] = o[campo] ? 'true' : 'false';
    return linha;
  });
  return Papa.unparse({ fields: [...COLUNAS_CSV], data: linhas });
}

export function baixarCsv(conteudo: string, nomeArquivo: string): void {
  const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
}
