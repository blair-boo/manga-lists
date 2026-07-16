import Papa from 'papaparse';
import type { NovaObra } from '../db/repo';
import type { Obra } from '../types';

const CAMPOS_TEXTO = ['tipo', 'autor', 'capa_url', 'status_leitura', 'status_publicacao', 'observacoes'] as const;
const CAMPOS_NUMERO = ['capitulo_atual', 'nota'] as const;
const CAMPOS_ARRAY = ['generos', 'tags', 'titulos_alternativos'] as const;

/** Ordem/colunas exatas que buildUpdatePayload sabe ler de volta (id/titulo + os três grupos acima). */
const COLUNAS_CSV = ['id', 'titulo', ...CAMPOS_TEXTO, ...CAMPOS_NUMERO, ...CAMPOS_ARRAY] as const;

function parseArrayCampo(valor: string | undefined): string[] | undefined {
  const v = (valor ?? '').trim();
  if (!v) return undefined; // vazio = não mexer
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

export function buildUpdatePayload(row: LinhaCsv): Partial<NovaObra> {
  const payload: Partial<NovaObra> = {};

  for (const campo of CAMPOS_TEXTO) {
    const v = (row[campo] ?? '').trim();
    if (v) payload[campo] = v as never;
  }

  for (const campo of CAMPOS_NUMERO) {
    const v = (row[campo] ?? '').trim();
    if (v) {
      const n = Number(v);
      if (!Number.isNaN(n)) payload[campo] = n;
    }
  }

  for (const campo of CAMPOS_ARRAY) {
    const arr = parseArrayCampo(row[campo]);
    if (arr !== undefined && arr.length > 0) payload[campo] = arr;
  }

  return payload;
}

export function parseCsvFile(texto: string): LinhaCsv[] {
  const resultado = Papa.parse<LinhaCsv>(texto, { header: true, skipEmptyLines: true });
  return resultado.data;
}

/**
 * Gera o CSV da tabela `obras` no mesmo formato que a atualização em massa
 * espera de volta (mesmas colunas/ordem; arrays com `;`, igual ao texto de
 * ajuda da tela) — download → editar → re-upload sem conversão manual.
 */
export function obrasParaCsv(obras: Obra[]): string {
  const linhas = obras.map((o) => {
    const linha: Record<string, string> = { id: o.id, titulo: o.titulo };
    for (const campo of CAMPOS_TEXTO) linha[campo] = (o[campo] as string | null) ?? '';
    for (const campo of CAMPOS_NUMERO) linha[campo] = o[campo] != null ? String(o[campo]) : '';
    for (const campo of CAMPOS_ARRAY) linha[campo] = (o[campo] ?? []).join('; ');
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
