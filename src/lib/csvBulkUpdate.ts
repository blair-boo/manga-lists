import Papa from 'papaparse';
import type { NovaObra } from '../db/repo';

const CAMPOS_TEXTO = ['tipo', 'autor', 'capa_url', 'status_leitura', 'status_publicacao', 'observacoes'] as const;
const CAMPOS_NUMERO = ['capitulo_atual', 'nota'] as const;
const CAMPOS_ARRAY = ['generos', 'tags'] as const;

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
