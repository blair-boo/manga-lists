import type { CampoInfoReader, Obra, ReaderCapitulo, ReaderEstadoObra, ReaderFonte, ReaderObra } from '../types';

// Módulo puro (sem acesso a rede/banco), pra poder ser testado direto — a
// gravação da página de informações mora em salvarInfoReader.ts, mesmo arranjo
// que obra.ts (puro) e salvarObra.ts (grava).

/** Estados em que o texto do capítulo já está no nosso storage. */
const ESTADOS_BAIXADOS: ReadonlySet<ReaderCapitulo['estado']> = new Set(['baixado', 'formatado', 'publicado']);

/**
 * Um capítulo `bloqueado` cuja data de liberação já passou não está mais preso:
 * a varredura é quinzenal, então entre uma passagem e outra o paywall cai sem
 * que ninguém tenha reescrito o estado no banco. Tratar como liberado é o que
 * faz o painel não mentir nos ~15 dias entre varreduras.
 */
export function paywallLiberado(capitulo: ReaderCapitulo, agora: Date): boolean {
  if (capitulo.estado !== 'bloqueado') return false;
  if (!capitulo.disponivel_em) return false;
  // disponivel_em é DATE (sem hora): comparar por dia, não por instante, senão
  // o capítulo que libera hoje só contaria como livre à meia-noite UTC.
  return capitulo.disponivel_em <= agora.toISOString().slice(0, 10);
}

/**
 * Ordena capítulos pelo slot explícito `ordem`. Nunca por `numero`: side story
 * não tem lugar no eixo numérico dos capítulos regulares ("Side Story 3" pode
 * vir depois do capítulo 200), e vários vêm com `numero` nulo. Capítulos sem
 * `ordem` (cadastrados à mão, legados) caem por último, estáveis entre si.
 */
export function ordenarCapitulosReader(capitulos: ReaderCapitulo[]): ReaderCapitulo[] {
  return [...capitulos].sort((a, b) => {
    if (a.ordem == null && b.ordem == null) return 0;
    if (a.ordem == null) return 1;
    if (b.ordem == null) return -1;
    return a.ordem - b.ordem;
  });
}

/**
 * Motivo pelo qual os botões que dependem de rede ficam desabilitados nesta
 * fase. Num lugar só pra que ligá-los seja uma remoção, e não uma caçada por
 * strings espalhadas pelos componentes.
 */
export const AVISO_SEM_DOWNLOADER = 'Available once the downloader ships';

/** Data + hora curtas, no formato que o resto do app usa nos status. */
export function formatarDataHora(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Só a data — `disponivel_em` é DATE, sem hora, e exibir 00:00 confundiria. */
export function formatarData(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Identidade do capítulo dentro da obra, derivada do rótulo do site.
 *
 * Precisa ser estável entre "atrás de paywall" e "liberado", porque é nesse
 * momento que o capítulo ganha uma URL — usar URL como chave duplicaria os
 * bloqueados (todos vêm com href="#") e perderia o vínculo na liberação.
 *
 * Side story ganha prefixo `ss-` porque a numeração dela corre num eixo
 * próprio: existe "Side Story 3" numa obra que também tem "Chapter 3".
 *
 * Esta mesma regra existe do lado do Python (scraper/reader_capitulos.py) —
 * se mudar aqui, mude lá, senão a varredura passa a duplicar tudo.
 */
export function chaveCapitulo(
  numero: number | null,
  sideStory: boolean,
  numeroTexto?: string | null
): string {
  const prefixo = sideStory ? 'ss-' : '';
  if (numero != null && Number.isFinite(numero)) {
    // Normaliza a representação: 143.20 e 143.2 são o mesmo capítulo, e
    // `String(143.0)` já devolve '143'.
    return prefixo + String(numero);
  }
  // Sem número, cai no rótulo cru normalizado — melhor do que nada, e estável
  // enquanto o site não reescrever o texto.
  const cru = (numeroTexto ?? '').trim().toLowerCase();
  if (cru) {
    return prefixo + cru.replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '');
  }
  return '';
}

/**
 * Como o capítulo aparece na tela. `numero_texto` (o rótulo cru do site) ganha
 * quando existe, porque é ele que preserva o que a numeração perde — "Side
 * Story 3" e "Extra 2" não têm número que os represente.
 */
export function rotuloCapitulo(capitulo: ReaderCapitulo): string {
  if (capitulo.numero_texto) return capitulo.numero_texto;
  if (capitulo.numero != null) {
    const n = Number.isInteger(capitulo.numero) ? String(capitulo.numero) : capitulo.numero.toFixed(1);
    return capitulo.side_story ? `SS ${n}` : `Ch. ${n}`;
  }
  return capitulo.titulo ?? '—';
}

export interface ResumoReader {
  estado: ReaderEstadoObra;
  estadoEm: string | null;
  /** Capítulos cujo texto já está no storage. */
  baixados: number;
  /** Total de capítulos regulares conhecidos (exclui side stories). */
  total: number;
  sideStories: number;
  ultimoBaixado: ReaderCapitulo | null;
  /** Detectados e esperando você escolher a fonte e mandar baixar. */
  aguardandoDecisao: ReaderCapitulo[];
  /** Presos no paywall, com a data em que caem — ordenados pela data. */
  proximosDisponiveis: ReaderCapitulo[];
}

/**
 * Deriva o painel de uma obra a partir dos capítulos. É a única fonte de
 * verdade da UI: `reader_obras.estado` existe porque é o que o worker escreve,
 * mas entra aqui só como pista — se um job morreu no meio, o banco fica
 * mentindo "baixando" pra sempre e os capítulos contam a história certa.
 */
export function resumirReader(
  reader: ReaderObra,
  capitulos: ReaderCapitulo[],
  agora: Date = new Date()
): ResumoReader {
  const ordenados = ordenarCapitulosReader(capitulos);
  const regulares = ordenados.filter((c) => !c.side_story);
  const sideStories = ordenados.filter((c) => c.side_story);

  const baixados = ordenados.filter((c) => ESTADOS_BAIXADOS.has(c.estado));
  // O último baixado é o de maior `ordem`, não o último a ser baixado no tempo:
  // é isso que a lista mostra como "Last downloaded chapter".
  const ultimoBaixado = baixados.length > 0 ? baixados[baixados.length - 1] : null;

  const aguardandoDecisao = ordenados.filter((c) => c.estado === 'descoberto' || paywallLiberado(c, agora));
  const proximosDisponiveis = ordenados
    .filter((c) => c.estado === 'bloqueado' && !paywallLiberado(c, agora) && c.disponivel_em)
    .sort((a, b) => (a.disponivel_em ?? '').localeCompare(b.disponivel_em ?? ''));

  return {
    estado: derivarEstado(reader, ordenados, aguardandoDecisao, agora),
    estadoEm: reader.estado_em,
    baixados: baixados.length,
    total: reader.total_capitulos_site ?? regulares.length,
    sideStories: sideStories.length,
    ultimoBaixado,
    aguardandoDecisao,
    proximosDisponiveis,
  };
}

/**
 * Acima disso, um estado de trabalho gravado no banco ('baixando'/'buscando')
 * é tratado como job morto em vez de "em andamento". Sem isso, um worker que
 * quebrou no meio (morreu sem regravar o estado) deixa a obra "baixando" pra
 * sempre na tela. É o mesmo problema — e o mesmo limite — que scraper_runs já
 * teve com runs presas em 'rodando': ver LIMITE_RODANDO_MS em useScraperRun.ts.
 */
const LIMITE_TRABALHO_MS = 3 * 60 * 60 * 1000;

function trabalhoVivo(reader: ReaderObra, agora: Date): boolean {
  return agora.getTime() - new Date(reader.estado_em).getTime() < LIMITE_TRABALHO_MS;
}

function derivarEstado(
  reader: ReaderObra,
  capitulos: ReaderCapitulo[],
  aguardandoDecisao: ReaderCapitulo[],
  agora: Date
): ReaderEstadoObra {
  // 'baixando' é o único estado que os capítulos não conseguem revelar sozinhos
  // (o capítulo continua 'descoberto' enquanto o download roda), então aqui a
  // coluna do banco vale — mas só enquanto o job puder estar vivo.
  if (reader.estado === 'baixando' && trabalhoVivo(reader, agora)) return 'baixando';
  // 'formatando' NÃO consulta a coluna: capítulo em 'baixado' é a prova direta
  // de que falta formatar, e é o que continua verdadeiro mesmo se o job morreu.
  if (capitulos.some((c) => c.estado === 'baixado')) return 'formatando';
  // busca_manual é escolha sua e não expira; 'buscando' gravado pelo worker sim.
  if (reader.busca_manual) return 'buscando';
  if (reader.estado === 'buscando' && trabalhoVivo(reader, agora)) return 'buscando';
  // Nada rodando: tem capítulo esperando sua decisão?
  if (aguardandoDecisao.length > 0) return 'disponivel';
  if (capitulos.length > 0 && capitulos.every((c) => c.estado === 'publicado')) return 'pronto';
  return 'aguardando';
}

const ROTULOS_ESTADO: Record<ReaderEstadoObra, string> = {
  aguardando: 'Waiting for new chapters',
  disponivel: 'New chapters available',
  buscando: 'Searching for new chapters',
  baixando: 'Downloading',
  formatando: 'Formatting',
  pronto: 'Up to date',
};

export function rotuloEstadoReader(estado: ReaderEstadoObra): string {
  return ROTULOS_ESTADO[estado];
}

/**
 * Fontes cuja faixa cobre um capítulo. Retorna LISTA, não item: faixas
 * sobrepostas são permitidas de propósito (é o caso em que você escolhe de qual
 * grupo baixar). `preferida` primeiro, para a UI ter um default sem impor.
 */
export function fontesParaCapitulo(fontes: ReaderFonte[], numero: number): ReaderFonte[] {
  return fontes
    .filter((f) => f.ativa)
    .filter((f) => (f.de == null || numero >= f.de) && (f.ate == null || numero <= f.ate))
    .sort((a, b) => Number(b.preferida) - Number(a.preferida));
}

/** A fonte que a UI usa como padrão: a preferida, ou a primeira ativa. */
export function fontePreferida(fontes: ReaderFonte[]): ReaderFonte | null {
  const ativas = ordenarFontesReader(fontes).filter((f) => f.ativa);
  return ativas.find((f) => f.preferida) ?? ativas[0] ?? null;
}

/** Ordena por `ordem`, caindo pra `de` (início da faixa) quando não há ordem. */
export function ordenarFontesReader(fontes: ReaderFonte[]): ReaderFonte[] {
  return [...fontes].sort((a, b) => (a.ordem ?? a.de ?? 0) - (b.ordem ?? b.de ?? 0));
}

/**
 * Monta o campo "Translation" da página de informações a partir das fontes —
 * ex. "1-150 Eternalune / 151-X Novelupdates". Faixa aberta (`ate` null) vira
 * "X", que é como você escreve à mão hoje.
 */
export function textoTraducao(fontes: ReaderFonte[]): string {
  return ordenarFontesReader(fontes)
    .filter((f) => f.ativa)
    .map((f) => {
      const de = f.de ?? 1;
      const ate = f.ate == null ? 'X' : String(f.ate);
      return `${de}-${ate} ${f.grupo}`;
    })
    .join(' / ');
}

/** De qual coluna de `obras` cada campo da página de informações herda. */
export const ORIGEM_NA_OBRA: Record<CampoInfoReader, keyof Obra> = {
  titulo: 'titulo',
  autor: 'autor',
  score: 'score',
  status: 'status_publicacao',
  generos: 'generos',
  tags: 'tags',
  link: 'novelupdates_url',
  sinopse: 'observacoes',
};

/** Colunas de override na tabela do Reader — subconjunto de ReaderObra. */
export type ColunaInfoReader = Extract<keyof ReaderObra, `info_${string}`>;

export const COLUNA_OVERRIDE: Record<CampoInfoReader, ColunaInfoReader> = {
  titulo: 'info_titulo',
  autor: 'info_autor',
  score: 'info_score',
  status: 'info_status',
  generos: 'info_generos',
  tags: 'info_tags',
  link: 'info_link',
  sinopse: 'info_sinopse',
};

/**
 * Valor efetivo de um campo da página de informações: o override do Reader
 * quando preenchido, senão o que está no cadastro da obra. É o que faz "deixei
 * em branco" significar "usa o do Ratsnest" em vez de "está vazio".
 */
export function valorInfo(reader: ReaderObra, obra: Obra | undefined, campo: CampoInfoReader): unknown {
  const override = reader[COLUNA_OVERRIDE[campo]];
  if (override !== null && override !== undefined && override !== '') return override;
  return obra ? obra[ORIGEM_NA_OBRA[campo]] : null;
}

/** True quando o campo está com valor próprio no Reader (não herdado da obra). */
export function temOverride(reader: ReaderObra, campo: CampoInfoReader): boolean {
  const override = reader[COLUNA_OVERRIDE[campo]];
  return override !== null && override !== undefined && override !== '';
}

