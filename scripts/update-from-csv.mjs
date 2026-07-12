// Atualização em massa: aplica um CSV editado (exportado da tabela `obras` no
// Table Editor do Supabase, preenchido manualmente) de volta ao banco.
//
// Uso: node scripts/update-from-csv.mjs caminho/para/obras-preenchido.csv
// Requer scripts/.env com SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
//
// Regras:
// - Cada linha é casada pelo `id` (não mexa nessa coluna nem na de título).
// - Célula vazia = mantém o valor atual no banco (não apaga nada).
// - Célula preenchida = sobrescreve o valor atual.
// - Gêneros/Tags aceitam `;` entre múltiplos valores (ex: "Romance;Fantasy"),
//   além dos formatos que o próprio Supabase pode exportar ({a,b} ou ["a","b"]).

import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { createClient } from '@supabase/supabase-js';
import { loadScriptsEnv, requireEnv } from './lib/env.mjs';

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Uso: node scripts/update-from-csv.mjs caminho/para/obras-preenchido.csv');
  process.exit(1);
}

loadScriptsEnv();
const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'));

const CAMPOS_TEXTO = ['tipo', 'autor', 'capa_url', 'status_leitura', 'status_publicacao', 'observacoes'];
const CAMPOS_NUMERO = ['capitulo_atual', 'nota'];
const CAMPOS_ARRAY = ['generos', 'tags'];

function parseArrayCampo(valor) {
  const v = (valor ?? '').trim();
  if (!v) return undefined; // vazio = não mexer
  if (v.startsWith('{') && v.endsWith('}')) {
    const inner = v.slice(1, -1).trim();
    return inner ? inner.split(',').map((s) => s.trim()) : [];
  }
  if (v.startsWith('[') && v.endsWith(']')) {
    try {
      return JSON.parse(v);
    } catch {
      // cai pro parser de ; abaixo
    }
  }
  return v.split(';').map((s) => s.trim()).filter(Boolean);
}

function buildUpdatePayload(row) {
  const payload = {};

  for (const campo of CAMPOS_TEXTO) {
    const v = (row[campo] ?? '').trim();
    if (v) payload[campo] = v;
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

async function main() {
  const content = readFileSync(csvPath, 'utf-8');
  const rows = parse(content, { columns: true, skip_empty_lines: true, trim: true });

  console.log(`${rows.length} linhas no CSV.`);

  let atualizadas = 0;
  let semMudanca = 0;
  let semId = 0;
  const erros = [];

  for (const row of rows) {
    const id = (row.id ?? '').trim();
    if (!id) {
      semId++;
      continue;
    }

    const payload = buildUpdatePayload(row);
    if (Object.keys(payload).length === 0) {
      semMudanca++;
      continue;
    }

    const { error } = await supabase.from('obras').update(payload).eq('id', id);
    if (error) {
      erros.push({ id, titulo: row.titulo, error: error.message });
      continue;
    }
    atualizadas++;
  }

  console.log(`\nAtualizadas: ${atualizadas}`);
  console.log(`Sem mudança (todas as colunas vazias): ${semMudanca}`);
  if (semId > 0) console.log(`Linhas sem id (ignoradas): ${semId}`);
  if (erros.length > 0) {
    console.log(`\nErros (${erros.length}):`);
    for (const e of erros) console.log(`  ${e.titulo} (${e.id}): ${e.error}`);
  }
}

main().catch((err) => {
  console.error('Falha ao atualizar:', err);
  process.exit(1);
});
