// Importação inicial dos dados da planilha para o Supabase.
// Uso: node scripts/import-data.mjs
// Requer scripts/.env com SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY
// (a service role key ignora RLS — nunca usar essa chave no app, só aqui, localmente).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { createClient } from '@supabase/supabase-js';
import { loadScriptsEnv, requireEnv } from './lib/env.mjs';

loadScriptsEnv();
const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');

function readCsv(filename) {
  const content = readFileSync(path.join(dataDir, filename), 'utf-8');
  return parse(content, { columns: true, skip_empty_lines: true, trim: true });
}

function orNull(v) {
  return v === undefined || v === null || v === '' ? null : v;
}

function orNullNumber(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

const SITE_POR_DOMINIO = {
  'ezmanga.org': 'ezmanga',
  'nyxscans.com': 'nyxscans',
};

/** Deriva o slug de `site` a partir do host da URL, pra bater com `sites_suportados.nome`. */
function deriveSite(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (SITE_POR_DOMINIO[host]) return SITE_POR_DOMINIO[host];
    return host.split('.')[0];
  } catch {
    return null;
  }
}

function orNullArray(v) {
  if (v === undefined || v === null || v === '') return null;
  return String(v)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function importListas() {
  const rows = readCsv('listas_seed.csv');
  const payload = rows.map((r) => ({ categoria: r.categoria, valor: r.valor }));
  console.log(`listas: importando ${payload.length} linhas…`);
  const { error } = await supabase
    .from('listas')
    .upsert(payload, { onConflict: 'categoria,valor', ignoreDuplicates: true });
  if (error) throw error;
  console.log('listas: ok');
}

/** Retorna Map<titulo_lowercase, obra_id> com o que já existe no banco. */
async function fetchObrasExistentes() {
  const { data, error } = await supabase.from('obras').select('id, titulo');
  if (error) throw error;
  const map = new Map();
  for (const o of data) map.set(o.titulo.trim().toLowerCase(), o.id);
  return map;
}

/** Importa obras_import.csv. Retorna Map<ref, obra_id> pra resolver fontes_import.csv em seguida. */
async function importObras() {
  const rows = readCsv('obras_import.csv');
  const existentes = await fetchObrasExistentes();
  const refParaId = new Map();
  const novas = [];

  for (const r of rows) {
    const tituloLower = r.titulo.trim().toLowerCase();
    const existenteId = existentes.get(tituloLower);
    if (existenteId) {
      refParaId.set(r.ref, existenteId);
      continue;
    }
    const id = crypto.randomUUID();
    refParaId.set(r.ref, id);
    novas.push({
      id,
      tipo: orNull(r.tipo),
      titulo: r.titulo,
      autor: orNull(r.autor),
      capa_url: orNull(r.capa_url),
      capitulo_atual: orNullNumber(r.capitulo_atual),
      status_leitura: orNull(r.status_leitura),
      status_publicacao: orNull(r.status_publicacao),
      nota: orNullNumber(r.nota),
      generos: orNullArray(r.generos),
      tags: orNullArray(r.tags),
      observacoes: orNull(r.observacoes),
    });
  }

  console.log(`obras: ${novas.length} novas de ${rows.length} no CSV (${rows.length - novas.length} já existiam)`);
  if (novas.length > 0) {
    const { error } = await supabase.from('obras').insert(novas);
    if (error) throw error;
  }
  console.log('obras: ok');
  return refParaId;
}

async function importFontes(refParaId) {
  const rows = readCsv('fontes_import.csv');

  const { data: fontesExistentes, error: fetchError } = await supabase.from('fontes').select('obra_id, url');
  if (fetchError) throw fetchError;
  const chavesExistentes = new Set(fontesExistentes.map((f) => `${f.obra_id}::${f.url}`));

  const novas = [];
  const semObra = [];

  for (const r of rows) {
    const obraId = refParaId.get(r.obra_ref);
    if (!obraId) {
      semObra.push(r.obra_ref);
      continue;
    }
    const chave = `${obraId}::${r.url}`;
    if (chavesExistentes.has(chave)) continue;
    novas.push({
      obra_id: obraId,
      site: deriveSite(r.url),
      url: r.url,
      ultimo_capitulo_detectado: orNullNumber(r.chapter_hint),
      confiavel: true,
      status_aprovacao: 'aprovado',
      descoberta_automaticamente: false,
      ultima_verificacao: null,
    });
    chavesExistentes.add(chave);
  }

  if (semObra.length > 0) {
    console.warn('fontes: obra_ref sem obra correspondente, ignorados:', semObra);
  }
  console.log(`fontes: ${novas.length} novas de ${rows.length} no CSV`);
  if (novas.length > 0) {
    const { error } = await supabase.from('fontes').insert(novas);
    if (error) throw error;
  }
  console.log('fontes: ok');
}

async function main() {
  await importListas();
  const refParaId = await importObras();
  await importFontes(refParaId);
  console.log('Importação concluída.');
}

main().catch((err) => {
  console.error('Falha na importação:', err);
  process.exit(1);
});
