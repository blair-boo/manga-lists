// Gera o SQL de importação (listas / obras+fontes) a partir dos CSVs locais,
// pra rodar via mcp__Supabase__execute_sql (não depende de rede da sandbox).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');

function readCsv(filename) {
  const content = readFileSync(path.join(dataDir, filename), 'utf-8');
  return parse(content, { columns: true, skip_empty_lines: true, trim: true });
}

function sqlStr(v) {
  if (v === undefined || v === null || v === '') return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function sqlNum(v) {
  if (v === undefined || v === null || v === '') return 'NULL';
  const n = Number(v);
  return Number.isNaN(n) ? 'NULL' : String(n);
}

function sqlArray(v) {
  if (v === undefined || v === null || v === '') return 'NULL';
  const items = String(v)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) return 'NULL';
  return `ARRAY[${items.map(sqlStr).join(', ')}]::text[]`;
}

// --- listas ---
const listas = readCsv('listas_seed.csv');
const listasValues = listas.map((r) => `(${sqlStr(r.categoria)}, ${sqlStr(r.valor)})`).join(',\n  ');
const listasSql = `INSERT INTO listas (categoria, valor) VALUES\n  ${listasValues}\nON CONFLICT (categoria, valor) DO NOTHING;\n`;
writeFileSync(path.join(__dirname, 'out-listas.sql'), listasSql);
console.log(`listas: ${listas.length} linhas -> scripts/out-listas.sql`);

// --- obras + fontes (combinado, com staging temporário pra resolver obra_ref -> obra_id) ---
const obras = readCsv('obras_import.csv');
const fontes = readCsv('fontes_import.csv');

const SITE_POR_DOMINIO = { 'ezmanga.org': 'ezmanga', 'nyxscans.com': 'nyxscans' };
function siteCase(url) {
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  })();
  if (!host) return 'NULL';
  return sqlStr(SITE_POR_DOMINIO[host] ?? host.split('.')[0]);
}

const obrasValues = obras
  .map(
    (r) =>
      `(${sqlStr(r.ref)}, ${sqlStr(r.tipo)}, ${sqlStr(r.titulo)}, ${sqlStr(r.autor)}, ${sqlStr(r.capa_url)}, ${sqlNum(
        r.capitulo_atual
      )}, ${sqlStr(r.status_leitura)}, ${sqlStr(r.status_publicacao)}, ${sqlNum(r.nota)}, ${sqlArray(
        r.generos
      )}, ${sqlArray(r.tags)}, ${sqlStr(r.observacoes)})`
  )
  .join(',\n  ');

const fontesValues = fontes
  .map((r) => `(${sqlStr(r.obra_ref)}, ${sqlStr(r.url)}, ${sqlNum(r.chapter_hint)}, ${siteCase(r.url)})`)
  .join(',\n  ');

const obrasFontesSql = `
CREATE TEMP TABLE obras_staging (
  ref text, tipo text, titulo text, autor text, capa_url text, capitulo_atual numeric,
  status_leitura text, status_publicacao text, nota int, generos text[], tags text[], observacoes text
) ON COMMIT DROP;

INSERT INTO obras_staging (ref, tipo, titulo, autor, capa_url, capitulo_atual, status_leitura, status_publicacao, nota, generos, tags, observacoes) VALUES
  ${obrasValues};

INSERT INTO obras (tipo, titulo, autor, capa_url, capitulo_atual, status_leitura, status_publicacao, nota, generos, tags, observacoes)
SELECT s.tipo, s.titulo, s.autor, s.capa_url, s.capitulo_atual, s.status_leitura, s.status_publicacao, s.nota, s.generos, s.tags, s.observacoes
FROM obras_staging s
WHERE NOT EXISTS (SELECT 1 FROM obras o WHERE lower(o.titulo) = lower(s.titulo));

CREATE TEMP TABLE ref_map ON COMMIT DROP AS
SELECT s.ref, o.id AS obra_id
FROM obras_staging s
JOIN obras o ON lower(o.titulo) = lower(s.titulo);

CREATE TEMP TABLE fontes_staging (obra_ref text, url text, chapter_hint numeric, site text) ON COMMIT DROP;

INSERT INTO fontes_staging (obra_ref, url, chapter_hint, site) VALUES
  ${fontesValues};

INSERT INTO fontes (obra_id, site, url, ultimo_capitulo_detectado, confiavel, status_aprovacao, descoberta_automaticamente, ultima_verificacao)
SELECT rm.obra_id, fs.site, fs.url, fs.chapter_hint, true, 'aprovado', false, NULL
FROM fontes_staging fs
JOIN ref_map rm ON rm.ref = fs.obra_ref
WHERE NOT EXISTS (SELECT 1 FROM fontes f WHERE f.obra_id = rm.obra_id AND f.url = fs.url);

SELECT
  (SELECT count(*) FROM obras) AS total_obras,
  (SELECT count(*) FROM fontes) AS total_fontes,
  (SELECT count(*) FROM listas) AS total_listas;
`;

writeFileSync(path.join(__dirname, 'out-obras-fontes.sql'), obrasFontesSql);
console.log(`obras: ${obras.length} linhas, fontes: ${fontes.length} linhas -> scripts/out-obras-fontes.sql`);
