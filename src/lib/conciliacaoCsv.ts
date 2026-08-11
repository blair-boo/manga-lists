import Papa from 'papaparse';
import { normalizarTitulo } from './duplicatas';
import { tokenSortRatio } from './tokenSortRatio';
import type { LimiaresOperacao } from './scraperConfig';
import type { Tipo } from '../types';

/**
 * Modo 3 da importação CSV (Conciliação de sites relacionados): lógica pura
 * de parsing, dedup e matching por título — sem Dexie/Supabase, testável
 * isolada (mesmo padrão de duplicatas.ts/csvBulkUpdate.ts). A escrita de
 * verdade (gravar na obra, mexer na fila/blacklist) fica em conciliacaoRepo.ts.
 */

export interface LinhaConciliacao {
  titulo: string;
  url: string;
}

// --- Parsing: só as duas primeiras colunas, resto é ignorado ---------------

/** Heurística simples pra saber se uma célula parece uma URL (vs. um cabeçalho tipo "Link"). */
function pareceUrl(v: string): boolean {
  try {
    return Boolean(new URL(v.trim()));
  } catch {
    return false;
  }
}

export interface ResultadoParseConciliacao {
  linhas: LinhaConciliacao[];
  /** true quando a primeira linha do arquivo foi detectada como cabeçalho e descartada. */
  comCabecalho: boolean;
}

/**
 * Lê um CSV de título+link (Modo 3): só as duas primeiras colunas contam,
 * quaisquer outras são ignoradas. Detecta cabeçalho automaticamente — se a
 * segunda célula da primeira linha não parece uma URL, essa linha é tratada
 * como cabeçalho e descartada; senão todas as linhas são dados.
 */
export function parseCsvConciliacao(texto: string): ResultadoParseConciliacao {
  const resultado = Papa.parse<string[]>(texto, { header: false, skipEmptyLines: true });
  const brutas = resultado.data;
  if (brutas.length === 0) return { linhas: [], comCabecalho: false };

  const comCabecalho = (brutas[0]?.length ?? 0) >= 2 && !pareceUrl(brutas[0][1] ?? '');
  const dados = comCabecalho ? brutas.slice(1) : brutas;

  const linhas: LinhaConciliacao[] = [];
  for (const cols of dados) {
    const titulo = (cols[0] ?? '').trim();
    const url = (cols[1] ?? '').trim();
    if (!titulo || !url) continue;
    linhas.push({ titulo, url });
  }
  return { linhas, comCabecalho };
}

// --- Dedup de "versão preferida" (ex.: "[Full ver.]") -----------------------

/**
 * Sufixos que indicam, quando duas linhas do CSV têm o mesmo título base, qual
 * delas é a "versão preferida" pra usar como link/match (ex.: pedido original
 * "If It's Remorse You Desire" + "If It's Remorse You Desire [Full ver.]" —
 * usa o link da versão [Full ver.], mas grava o título sem o sufixo como
 * título alternativo). Lista pequena de propósito: cobre o padrão conhecido e
 * variações óbvias, mas é só adicionar aqui se aparecer outro site com um
 * sufixo parecido — o resto da lógica não muda.
 */
const SUFIXOS_VERSAO_PREFERIDA = ['[full ver.]', '[full ver]', '(full ver.)', '(full ver)', '(uncut)', '(extended)'];

function removerSufixoVersaoPreferida(titulo: string): { base: string; temSufixo: boolean } {
  const t = titulo.trim();
  const lower = t.toLowerCase();
  for (const sufixo of SUFIXOS_VERSAO_PREFERIDA) {
    if (lower.endsWith(sufixo)) {
      return { base: t.slice(0, t.length - sufixo.length).trim(), temSufixo: true };
    }
  }
  return { base: t, temSufixo: false };
}

export type LinhaDeduplicada = LinhaConciliacao;

/**
 * Agrupa linhas do CSV pelo título base (normalizado, sem o sufixo de versão
 * preferida). Quando um grupo tem a variante preferida (ex.: "[Full ver.]") E
 * a variante simples, colapsa as duas numa linha só: usa o **título simples**
 * (sem sufixo) — é ele que entra no matching e, se a faixa de score pedir
 * (90-99%), é o texto gravado em `titulos_alternativos`, igual a qualquer
 * outra linha — mas com o **link da variante preferida**. Grupos sem essa
 * combinação passam direto, sem mudança.
 */
export function deduplicarVersaoPreferida(linhas: LinhaConciliacao[]): LinhaDeduplicada[] {
  const porBase = new Map<string, LinhaConciliacao[]>();
  for (const linha of linhas) {
    const { base } = removerSufixoVersaoPreferida(linha.titulo);
    const chave = normalizarTitulo(base);
    const grupo = porBase.get(chave) ?? [];
    grupo.push(linha);
    porBase.set(chave, grupo);
  }

  const resultado: LinhaDeduplicada[] = [];
  for (const grupo of porBase.values()) {
    const preferida = grupo.find((l) => removerSufixoVersaoPreferida(l.titulo).temSufixo);
    const simples = grupo.find((l) => l !== preferida);
    if (preferida && simples) {
      resultado.push({ titulo: removerSufixoVersaoPreferida(simples.titulo).base, url: preferida.url });
    } else {
      for (const linha of grupo) resultado.push(linha);
    }
  }
  return resultado;
}

// --- Filtro por tipo e matching por título ----------------------------------

export interface CandidatoObra {
  obraId: string;
  titulo: string;
  titulosAlternativos: string[] | null;
  tipo: Tipo | null;
}

/** Só obras do(s) tipo(s) selecionado(s) pra essa importação entram na comparação (as demais são ignoradas, não descartadas). */
export function filtrarObrasPorTipo(obras: CandidatoObra[], tiposPermitidos: ReadonlySet<Tipo>): CandidatoObra[] {
  return obras.filter((o) => o.tipo != null && tiposPermitidos.has(o.tipo));
}

export interface CandidatoComScore {
  obraId: string;
  score: number;
}

/**
 * Maior score de `titulo` contra título+alternativos de cada obra candidata
 * (token_sort_ratio — mesma métrica do scraper Python). Retorna todas as
 * obras empatadas no maior score (normalmente 1, mas mais de 1 quando duas
 * obras diferentes têm o mesmo título/alternativo — ambíguo, tratado como
 * "não decide sozinho" por quem chama).
 */
export function melhorMatch(titulo: string, obras: CandidatoObra[]): CandidatoComScore[] {
  let melhorScore = -1;
  let melhores: CandidatoComScore[] = [];
  for (const obra of obras) {
    const titulos = [obra.titulo, ...(obra.titulosAlternativos ?? [])];
    const score = Math.max(...titulos.map((t) => tokenSortRatio(titulo, t)));
    if (score > melhorScore) {
      melhorScore = score;
      melhores = [{ obraId: obra.obraId, score }];
    } else if (score === melhorScore) {
      melhores.push({ obraId: obra.obraId, score });
    }
  }
  return melhores;
}

// --- Classificação por faixa de score ---------------------------------------

export type ClassificacaoConciliacao = 'aprovado_exato' | 'aprovado_com_alt_titulo' | 'pendente' | 'descartado';

/**
 * Classifica um match único (sem ambiguidade) pela faixa de score:
 * - >= limiar_auto_aprovacao e == 1 (match exato contra título/alternativo): aprova sem mexer em títulos alternativos.
 * - >= limiar_auto_aprovacao e < 1 (ex.: 90-99%): aprova E grava o título candidato como alternativo.
 * - >= limiar_minimo_pendencia: vai pra fila de aprovação manual.
 * - abaixo disso: descarta, sem registrar.
 * Um match ambíguo (`melhorMatch` retornando mais de uma obra) é decisão de
 * quem chama — sempre tratado como pendente, nunca auto-aprovado.
 */
export function classificarScore(score: number, limiares: LimiaresOperacao): ClassificacaoConciliacao {
  if (score >= limiares.limiar_auto_aprovacao) return score >= 1 ? 'aprovado_exato' : 'aprovado_com_alt_titulo';
  if (score >= limiares.limiar_minimo_pendencia) return 'pendente';
  return 'descartado';
}

// --- Plano completo (pré-visualização antes de gravar qualquer coisa) ------

export interface ItemAutoAprovado {
  obraId: string;
  obraTitulo: string;
  titulo: string;
  url: string;
  score: number;
  /** true = match exato (não mexe em títulos alternativos); false = 90-99% (grava `titulo` como alternativo). */
  exato: boolean;
}

export interface ItemPendente {
  obraId: string;
  obraTitulo: string;
  obraTitulosAlternativos: string[] | null;
  titulo: string;
  url: string;
  score: number;
  /** true quando esse candidato empatou em score com outra(s) obra(s) — mostrado na fila mesmo se o score seria de auto-aprovação sozinho. */
  ambiguo: boolean;
}

export interface PlanoConciliacao {
  autoAprovados: ItemAutoAprovado[];
  pendentesNovos: ItemPendente[];
  puladosBlacklist: number;
  descartados: number;
}

/** Chave de blacklist: par (obra, url) — mesmo formato usado por `conciliacao_blacklist`. */
export function chaveBlacklist(obraId: string, url: string): string {
  return `${obraId}::${url}`;
}

/**
 * Monta o plano completo do Modo 3 a partir das linhas já lidas do CSV: dedup
 * de versão preferida, matching por título contra os candidatos (já
 * filtrados por tipo por quem chama, via `filtrarObrasPorTipo`), pulando
 * pares já rejeitados na blacklist. Não escreve nada — só decide o que cada
 * linha viraria (auto-aprovado / fila / descartado), pra mostrar como
 * pré-visualização antes de aplicar (`aplicarPlanoConciliacao`, em
 * conciliacaoRepo.ts). Um empate de score entre duas obras nunca auto-aprova
 * sozinho: vira um item por obra empatada na fila, pra decisão manual.
 */
export function montarPlanoConciliacao(
  linhasCsv: LinhaConciliacao[],
  candidatos: CandidatoObra[],
  blacklist: ReadonlySet<string>,
  limiares: LimiaresOperacao
): PlanoConciliacao {
  const linhas = deduplicarVersaoPreferida(linhasCsv);
  const porId = new Map(candidatos.map((c) => [c.obraId, c]));
  const autoAprovados: ItemAutoAprovado[] = [];
  const pendentesNovos: ItemPendente[] = [];
  let puladosBlacklist = 0;
  let descartados = 0;

  for (const linha of linhas) {
    const melhores = melhorMatch(linha.titulo, candidatos);
    if (melhores.length === 0) {
      descartados++;
      continue;
    }
    const ambiguo = melhores.length > 1;
    const { score } = melhores[0];
    const classe = classificarScore(score, limiares);
    if (classe === 'descartado') {
      descartados++;
      continue;
    }

    if (ambiguo) {
      for (const m of melhores) {
        if (blacklist.has(chaveBlacklist(m.obraId, linha.url))) {
          puladosBlacklist++;
          continue;
        }
        const obra = porId.get(m.obraId);
        if (!obra) continue;
        pendentesNovos.push({
          obraId: m.obraId,
          obraTitulo: obra.titulo,
          obraTitulosAlternativos: obra.titulosAlternativos,
          titulo: linha.titulo,
          url: linha.url,
          score: m.score,
          ambiguo: true,
        });
      }
      continue;
    }

    const obraId = melhores[0].obraId;
    if (blacklist.has(chaveBlacklist(obraId, linha.url))) {
      puladosBlacklist++;
      continue;
    }
    const obra = porId.get(obraId);
    if (!obra) continue;

    if (classe === 'pendente') {
      pendentesNovos.push({
        obraId,
        obraTitulo: obra.titulo,
        obraTitulosAlternativos: obra.titulosAlternativos,
        titulo: linha.titulo,
        url: linha.url,
        score,
        ambiguo: false,
      });
    } else {
      autoAprovados.push({
        obraId,
        obraTitulo: obra.titulo,
        titulo: linha.titulo,
        url: linha.url,
        score,
        exato: classe === 'aprovado_exato',
      });
    }
  }

  return { autoAprovados, pendentesNovos, puladosBlacklist, descartados };
}
