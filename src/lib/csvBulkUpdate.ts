import Papa from 'papaparse';
import type { NovaObra } from '../db/repo';
import { colunaCsvDaFonte } from './site';
import type { Fonte, Obra } from '../types';

/**
 * Campos que a atualização em massa via CSV sabe ler/escrever, agrupados por
 * como o valor é convertido. `id`/`titulo` ficam de fora (são identificadores —
 * o texto de ajuda pede pra não mexer neles) e `obra_vinculada_id` também
 * (o vínculo é mútuo e mantido por vincularObras/desvincularObra; editar o id
 * cru pelo CSV quebraria a reciprocidade). `criado_em`/`atualizado_em` (geridos
 * pelo banco) também ficam de fora de propósito: buildUpdatePayload só lê
 * colunas destes quatro grupos, então qualquer outra coluna do export bruto do
 * Supabase Table Editor (incluindo essas) é ignorada, mesmo se vier corrompida
 * no arquivo — ex.: planilhas costumam reformatar timestamp com vírgula sem
 * citar o campo, o que quebra o alinhamento das colunas NAQUELA linha no CSV
 * (parseCsvFile reporta essas linhas via `linhasComProblema`, ver abaixo).
 * Qualquer coluna nova da tabela `obras` passa a ser atualizada só
 * adicionando o nome no grupo certo aqui.
 */
const CAMPOS_TEXTO = [
  'tipo',
  'autor',
  'artistas',
  'capa_url',
  'status_leitura',
  'status_publicacao',
  'observacoes',
  'classificacao',
  'novelupdates_url',
  'anilist_url',
  'myanimelist_url',
  'mangaupdates_url',
  'mangadex_url',
  'mangabaka_url',
] as const;
const CAMPOS_NUMERO = ['capitulo_atual', 'score', 'ultimo_capitulo_lancado'] as const;
const CAMPOS_ARRAY = ['generos', 'tags', 'titulos_alternativos'] as const;
const CAMPOS_BOOL = ['fim_de_temporada', 'ultimo_capitulo_via_scraper', 'pdf'] as const;

/** `observacoes` é exportado/lido sob o nome "notes" no CSV (nome do campo no
 * banco continua `observacoes`) — mais claro pra quem edita a planilha, e não
 * confunde com `score` (ex-`nota`). */
const ROTULOS_CSV: Partial<Record<(typeof CAMPOS_TEXTO)[number], string>> = { observacoes: 'notes' };
function rotuloCsv(campo: (typeof CAMPOS_TEXTO)[number]): string {
  return ROTULOS_CSV[campo] ?? campo;
}

/** As três colunas de fontes do CSV — nenhuma é um campo de `obras` (moram na
 * tabela `fontes`), então não passam por buildUpdatePayload; CsvBulkSection lê
 * essas colunas à parte com `sourcesDaLinha` e reconcilia direto contra as
 * fontes da obra. A divisão em três é só organizacional (`colunaCsvDaFonte`
 * decide pela URL): `comix` (comix.to) e `official_sources` (sites
 * licenciados — manta/WebToon/Tappytoon/Tapas/Lezhin) ganham coluna própria
 * pra facilitar de bater o olho na planilha; `sources` continua com o resto
 * (scanlations genéricas). Não muda nada na exibição do app — as três
 * colunas viram a mesma tabela `fontes` de sempre. */
const COLUNAS_FONTES = ['sources', 'comix', 'official_sources'] as const;

/** Ordem/colunas exatas do CSV baixado (id/titulo + os quatro grupos acima +
 * as três colunas de fontes). */
const COLUNAS_CSV = [
  'id',
  'titulo',
  ...CAMPOS_TEXTO.map(rotuloCsv),
  ...CAMPOS_NUMERO,
  ...CAMPOS_ARRAY,
  ...CAMPOS_BOOL,
  ...COLUNAS_FONTES,
];

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
 * 'sobrescrever' é o comportamento histórico (Modo 1): célula vazia limpa o
 * campo, `sources` reconcilia com remoção. 'complementar' (Modo 2) é
 * não-destrutivo: célula vazia não mexe em nada, e tanto os campos array
 * quanto `sources` só somam (união com o valor atual), nunca removem.
 */
export type ModoImportacaoCsv = 'sobrescrever' | 'complementar';

/** Une dois arrays de string preservando a ordem (atual primeiro), sem duplicar. */
export function unirArrays(atual: string[] | null | undefined, novos: string[]): string[] {
  const vistos = new Set(atual ?? []);
  const unidos = [...(atual ?? [])];
  for (const v of novos) {
    if (!vistos.has(v)) {
      vistos.add(v);
      unidos.push(v);
    }
  }
  return unidos;
}

/**
 * Monta o patch a partir de uma linha do CSV.
 *
 * Regra de presença em modo 'sobrescrever' (Modo 1, default):
 * - coluna AUSENTE do CSV (nem no cabeçalho) → não entra no payload (não mexe);
 * - coluna PRESENTE porém vazia → limpa o campo (null, ou false pros booleanos);
 * - coluna PRESENTE com valor → grava o valor convertido (array/`titulos_alternativos`
 *   substitui o valor inteiro).
 * Número inválido (ex.: "abc") é a única exceção: ignora a célula em vez de
 * limpar, pra não zerar um valor por causa de erro de digitação.
 *
 * Em modo 'complementar' (Modo 2): coluna presente porém vazia também não
 * mexe em nada (em vez de limpar); campos array recebem união com o valor
 * atual da obra (`obraAtual`) em vez de substituir.
 */
export function buildUpdatePayload(
  row: LinhaCsv,
  modo: ModoImportacaoCsv = 'sobrescrever',
  obraAtual?: Pick<Obra, (typeof CAMPOS_ARRAY)[number]> | null
): Partial<NovaObra> {
  const payload: Partial<NovaObra> = {};
  const complementar = modo === 'complementar';

  for (const campo of CAMPOS_TEXTO) {
    const rotulo = rotuloCsv(campo);
    if (!(rotulo in row)) continue;
    const v = (row[rotulo] ?? '').trim();
    if (!v && complementar) continue;
    payload[campo] = (v || null) as never;
  }
  // Coluna status_publicacao presente no CSV (mesmo vazia, em modo
  // sobrescrever) é uma edição deliberada — trava contra sobrescrita do
  // scraper, igual ao autosave da tela de detalhe (B4).
  if ('status_publicacao' in payload) payload.status_publicacao_manual = true;

  for (const campo of CAMPOS_NUMERO) {
    if (!(campo in row)) continue;
    const v = (row[campo] ?? '').trim();
    if (!v) {
      if (complementar) continue;
      payload[campo] = null as never;
      continue;
    }
    const n = Number(v);
    if (!Number.isNaN(n)) payload[campo] = n as never;
  }

  for (const campo of CAMPOS_ARRAY) {
    if (!(campo in row)) continue;
    const arr = parseArrayCampo(row[campo]);
    if (complementar) {
      if (arr.length === 0) continue;
      const unidos = unirArrays(obraAtual?.[campo], arr);
      payload[campo] = (unidos.length > 0 ? unidos : null) as never;
      continue;
    }
    payload[campo] = (arr.length > 0 ? arr : null) as never;
  }

  for (const campo of CAMPOS_BOOL) {
    if (!(campo in row)) continue;
    const v = (row[campo] ?? '').trim().toLowerCase();
    payload[campo] = VALORES_BOOL_VERDADEIRO.has(v) as never;
  }

  return payload;
}

/**
 * Lê as três colunas de fontes (`sources`, `comix`, `official_sources`) de
 * uma linha do CSV e devolve a lista de URLs desejada pra obra (união das
 * três, sem duplicar) — mesma regra de presença das demais colunas:
 * `undefined` se NENHUMA das três está no cabeçalho (não mexe nas fontes);
 * array (possivelmente vazio) se ao menos uma está presente. Vazias limpam
 * as fontes correspondentes — mesma convenção de "célula vazia limpa o
 * campo" usada em `buildUpdatePayload`. A divisão em três colunas é só pra
 * organizar a planilha; quem reconcilia contra as fontes existentes (criar
 * as que faltam, apagar as que sobram, preservar as que batem) é
 * CsvBulkSection — aqui só faz o parse, já achatado numa lista só.
 */
export function sourcesDaLinha(row: LinhaCsv): string[] | undefined {
  const colunasPresentes = COLUNAS_FONTES.filter((coluna) => coluna in row);
  if (colunasPresentes.length === 0) return undefined;
  const vistas = new Set<string>();
  const urls: string[] = [];
  for (const coluna of colunasPresentes) {
    for (const url of parseArrayCampo(row[coluna])) {
      if (!vistas.has(url)) {
        vistas.add(url);
        urls.push(url);
      }
    }
  }
  return urls;
}

export interface ResultadoParseCsv {
  linhas: LinhaCsv[];
  /** Número de linhas do arquivo com campos a mais/a menos que o cabeçalho —
   * sinal de uma vírgula não citada (comum quando `criado_em`/`atualizado_em`
   * é reformatado por Excel/Sheets). As colunas conhecidas ANTES do ponto de
   * quebra ainda são lidas normalmente; só avisa, não bloqueia o upload. */
  linhasComProblema: number;
}

export function parseCsvFile(texto: string): ResultadoParseCsv {
  const resultado = Papa.parse<LinhaCsv>(texto, { header: true, skipEmptyLines: true });
  const linhasComProblema = new Set(
    resultado.errors.filter((e) => e.code === 'TooManyFields' || e.code === 'TooFewFields').map((e) => e.row)
  ).size;
  return { linhas: resultado.data, linhasComProblema };
}

/**
 * Lê um arquivo de bulk fill (Handout de organização das tabelas): aceita
 * .csv e .xlsx/.xls pela extensão (fallback pro MIME type quando o navegador
 * não preenche a extensão), convertendo os dois pro mesmo formato de linhas
 * que `buildUpdatePayload`/`sourcesDaLinha` leem. XLSX usa a primeira aba e a
 * primeira linha como cabeçalho; células numéricas/booleanas viram string
 * (mesma representação que o CSV usa), então o resto do pipeline não precisa
 * saber de onde a linha veio.
 */
export async function parseArquivoObras(file: File): Promise<ResultadoParseCsv> {
  const nome = file.name.toLowerCase();
  const ehXlsx =
    nome.endsWith('.xlsx') ||
    nome.endsWith('.xls') ||
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  if (!ehXlsx) {
    const texto = await file.text();
    return parseCsvFile(texto);
  }

  // Import dinâmico: só carrega a lib (pesada) quando a usuária efetivamente
  // sobe um .xlsx — mesmo truque de src/lib/imagensArquivo.ts (fora do bundle
  // inicial e do precache do PWA, ver vite.config.ts).
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const primeiraAba = workbook.SheetNames[0];
  if (!primeiraAba) return { linhas: [], linhasComProblema: 0 };
  const brutas = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[primeiraAba], { defval: '' });
  const linhas: LinhaCsv[] = brutas.map((linha) => {
    const convertida: LinhaCsv = {};
    for (const [chave, valor] of Object.entries(linha)) convertida[chave] = valor == null ? '' : String(valor);
    return convertida;
  });
  return { linhas, linhasComProblema: 0 };
}

/**
 * Monta as linhas da tabela `obras` no mesmo formato que a atualização em
 * massa espera de volta (mesmas colunas/ordem; arrays com `;`, booleanos como
 * true/false) — usado tanto pelo CSV quanto pelo XLSX, pra download → editar
 * → re-upload sem conversão manual. `fontesPorObra` (opcional) preenche as
 * três colunas de fontes (`sources`/`comix`/`official_sources`, ver
 * `COLUNAS_FONTES`) com as URLs de cada obra, separadas por `;`, agrupadas
 * pela URL via `colunaCsvDaFonte`; sem `fontesPorObra` as três saem vazias.
 */
function obrasParaLinhas(obras: Obra[], fontesPorObra?: Map<string, Fonte[]>): Record<string, string>[] {
  return obras.map((o) => {
    const linha: Record<string, string> = { id: o.id, titulo: o.titulo };
    for (const campo of CAMPOS_TEXTO) linha[rotuloCsv(campo)] = (o[campo] as string | null) ?? '';
    for (const campo of CAMPOS_NUMERO) linha[campo] = o[campo] != null ? String(o[campo]) : '';
    for (const campo of CAMPOS_ARRAY) linha[campo] = (o[campo] ?? []).join('; ');
    for (const campo of CAMPOS_BOOL) linha[campo] = o[campo] ? 'true' : 'false';

    const porColuna: Record<(typeof COLUNAS_FONTES)[number], string[]> = { sources: [], comix: [], official_sources: [] };
    for (const f of fontesPorObra?.get(o.id) ?? []) porColuna[colunaCsvDaFonte(f.url)].push(f.url);
    for (const coluna of COLUNAS_FONTES) linha[coluna] = porColuna[coluna].join('; ');

    return linha;
  });
}

export function obrasParaCsv(obras: Obra[], fontesPorObra?: Map<string, Fonte[]>): string {
  return Papa.unparse({ fields: [...COLUNAS_CSV], data: obrasParaLinhas(obras, fontesPorObra) });
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

/**
 * Mesmo conteúdo de `obrasParaCsv`, num arquivo .xlsx em vez de .csv — pra
 * quem prefere editar em Excel direto (evita o tropeço de campos com `;` ou
 * aspas sendo mal interpretados por algumas versões do Excel ao abrir CSV).
 * Import dinâmico da lib `xlsx`, mesmo motivo de `parseArquivoObras`.
 */
export async function baixarObrasXlsx(
  obras: Obra[],
  fontesPorObra: Map<string, Fonte[]> | undefined,
  nomeArquivo: string
): Promise<void> {
  const XLSX = await import('xlsx');
  const planilha = XLSX.utils.json_to_sheet(obrasParaLinhas(obras, fontesPorObra), { header: [...COLUNAS_CSV] });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, planilha, 'obras');
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
}
