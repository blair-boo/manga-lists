import { capitulosAtrasados, familiaDeTipo, temNovoCapitulo } from './obra';
import type { Fonte, Obra } from '../types';

/**
 * Estado dos filtros-botão (chips): 'off' não filtra, 'incluir' só mostra quem
 * bate a condição, 'excluir' mostra todo mundo MENOS quem bate. Clicar cicla
 * off -> incluir -> excluir -> off (Handout: filtros de exclusão nos chips).
 */
export type EstadoFiltro = 'off' | 'incluir' | 'excluir';

export function proximoEstadoFiltro(atual: EstadoFiltro): EstadoFiltro {
  if (atual === 'off') return 'incluir';
  if (atual === 'incluir') return 'excluir';
  return 'off';
}

export function passaFiltro(estado: EstadoFiltro, condicaoBatida: boolean): boolean {
  if (estado === 'incluir') return condicaoBatida;
  if (estado === 'excluir') return !condicaoBatida;
  return true;
}

function estadoFiltroValido(v: unknown): EstadoFiltro {
  return v === 'incluir' || v === 'excluir' ? v : 'off';
}

/** Notas (1-5) selecionadas no filtro de rating — descarta qualquer valor fora
 * da faixa (dado salvo corrompido/de versão futura). */
function scoresSelValidos(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.filter((n): n is number => typeof n === 'number' && n >= 1 && n <= 5);
}

/** Status de leitura renomeado (Complete -> Finished). Remapeia filtros salvos
 * antes da renomeação, senão o chip fica órfão e nunca casa com nada. */
const STATUS_LEITURA_RENOMEADOS: Record<string, string> = { Complete: 'Finished' };

/** 'aleatorio': modo de embaralhar da Lista Principal (botão dedicado, não uma
 * opção do select de Sort — por isso fica fora de ORDENACOES) e nunca é
 * persistido em localStorage['ordenacao'] (lerOrdenacaoSalva só valida contra
 * ORDENACOES, então cairia no default 'titulo' se por acaso fosse salvo). */
export type Ordenacao = 'titulo' | 'atualizado' | 'score' | 'atrasados' | 'criado' | 'aleatorio';

/** Ordenação renomeada (nota -> score). Remapeia o valor salvo antes da
 * renomeação, senão cai no default silenciosamente (ver lerOrdenacaoSalva). */
const ORDENACAO_RENOMEADAS: Record<string, string> = { nota: 'score' };

export const ORDENACOES: { valor: Ordenacao; rotulo: string }[] = [
  { valor: 'titulo', rotulo: 'Title (A–Z)' },
  { valor: 'atualizado', rotulo: 'Recently updated' },
  { valor: 'atrasados', rotulo: 'Most chapters behind' },
  { valor: 'score', rotulo: 'Highest rating' },
  { valor: 'criado', rotulo: 'Recently added' },
];

export function lerOrdenacaoSalva(): Ordenacao {
  const bruto = localStorage.getItem('ordenacao');
  const v = bruto ? (ORDENACAO_RENOMEADAS[bruto] ?? bruto) : bruto;
  return ORDENACOES.some((o) => o.valor === v) ? (v as Ordenacao) : 'titulo';
}

export function comparar(a: Obra, b: Obra, ordem: Ordenacao): number {
  switch (ordem) {
    case 'atualizado':
      return (b.atualizado_em ?? '').localeCompare(a.atualizado_em ?? '');
    case 'criado':
      return (b.criado_em ?? '').localeCompare(a.criado_em ?? '');
    case 'score':
      return (b.score ?? -1) - (a.score ?? -1) || a.titulo.localeCompare(b.titulo);
    case 'atrasados':
      return capitulosAtrasados(b) - capitulosAtrasados(a) || a.titulo.localeCompare(b.titulo);
    default:
      return a.titulo.localeCompare(b.titulo);
  }
}

/** Filtros da lista persistem entre navegações (só somem no "Clear filters"),
 * então salvamos tudo num único item do localStorage. Lido tanto pela lista
 * (pra restaurar o estado) quanto pela tela da obra (pro botão Next). */
export const FILTROS_KEY = 'filtrosLista';

export interface FiltrosSalvos {
  busca: string;
  tipo: string;
  statusLeituraFiltros: Record<string, EstadoFiltro>;
  statusPublicacao: string;
  generosSel: string[];
  tagsSel: string[];
  filtroFavorito: EstadoFiltro;
  filtroNovoCapitulo: EstadoFiltro;
  filtroNovel: EstadoFiltro;
  filtroUnsourced: EstadoFiltro;
  filtroSemCapa: EstadoFiltro;
  filtroSemNu: EstadoFiltro;
  filtroSemNota: EstadoFiltro;
  filtroSemTipo: EstadoFiltro;
  /** Classificação de conteúdo (Content rating), chips independentes por valor. */
  filtroR15: EstadoFiltro;
  filtroR18: EstadoFiltro;
  /** Filtro de nota (1-5): multi-seleção simples, sem estado de exclusão. */
  scoresSel: number[];
  /** Toggle "Include unrated": inclui obras sem nota junto do que bater scoresSel
   * (independente do gap-chip filtroSemNota, que é um "somente sem nota" exclusivo). */
  incluirSemNota: boolean;
}

export const FILTROS_PADRAO: FiltrosSalvos = {
  busca: '',
  tipo: '',
  statusLeituraFiltros: {},
  statusPublicacao: '',
  generosSel: [],
  tagsSel: [],
  filtroFavorito: 'off',
  filtroNovoCapitulo: 'off',
  filtroNovel: 'off',
  filtroUnsourced: 'off',
  filtroSemCapa: 'off',
  filtroSemNu: 'off',
  filtroSemNota: 'off',
  filtroSemTipo: 'off',
  filtroR15: 'off',
  filtroR18: 'off',
  scoresSel: [],
  incluirSemNota: false,
};

export function lerFiltrosSalvos(): FiltrosSalvos {
  try {
    const bruto = localStorage.getItem(FILTROS_KEY);
    if (!bruto) return FILTROS_PADRAO;
    const dados = JSON.parse(bruto) as Partial<FiltrosSalvos>;
    const statusLeituraFiltros: Record<string, EstadoFiltro> = {};
    for (const [k, v] of Object.entries(dados.statusLeituraFiltros ?? {})) {
      statusLeituraFiltros[STATUS_LEITURA_RENOMEADOS[k] ?? k] = estadoFiltroValido(v);
    }
    return {
      busca: typeof dados.busca === 'string' ? dados.busca : FILTROS_PADRAO.busca,
      tipo: typeof dados.tipo === 'string' ? dados.tipo : FILTROS_PADRAO.tipo,
      statusLeituraFiltros,
      statusPublicacao: typeof dados.statusPublicacao === 'string' ? dados.statusPublicacao : FILTROS_PADRAO.statusPublicacao,
      generosSel: Array.isArray(dados.generosSel) ? dados.generosSel : FILTROS_PADRAO.generosSel,
      tagsSel: Array.isArray(dados.tagsSel) ? dados.tagsSel : FILTROS_PADRAO.tagsSel,
      filtroFavorito: estadoFiltroValido(dados.filtroFavorito),
      filtroNovoCapitulo: estadoFiltroValido(dados.filtroNovoCapitulo),
      filtroNovel: estadoFiltroValido(dados.filtroNovel),
      filtroUnsourced: estadoFiltroValido(dados.filtroUnsourced),
      filtroSemCapa: estadoFiltroValido(dados.filtroSemCapa),
      filtroSemNu: estadoFiltroValido(dados.filtroSemNu),
      filtroSemNota: estadoFiltroValido(dados.filtroSemNota),
      filtroSemTipo: estadoFiltroValido(dados.filtroSemTipo),
      filtroR15: estadoFiltroValido(dados.filtroR15),
      filtroR18: estadoFiltroValido(dados.filtroR18),
      scoresSel: scoresSelValidos(dados.scoresSel),
      incluirSemNota: typeof dados.incluirSemNota === 'boolean' ? dados.incluirSemNota : FILTROS_PADRAO.incluirSemNota,
    };
  } catch {
    return FILTROS_PADRAO;
  }
}

export function temFiltroAtivo(f: FiltrosSalvos): boolean {
  return (
    !!f.busca ||
    !!f.tipo ||
    Object.values(f.statusLeituraFiltros).some((v) => v !== 'off') ||
    !!f.statusPublicacao ||
    f.generosSel.length > 0 ||
    f.tagsSel.length > 0 ||
    f.filtroFavorito !== 'off' ||
    f.filtroNovoCapitulo !== 'off' ||
    f.filtroNovel !== 'off' ||
    f.filtroUnsourced !== 'off' ||
    f.filtroSemCapa !== 'off' ||
    f.filtroSemNu !== 'off' ||
    f.filtroSemNota !== 'off' ||
    f.filtroSemTipo !== 'off' ||
    f.filtroR15 !== 'off' ||
    f.filtroR18 !== 'off' ||
    f.scoresSel.length > 0 ||
    f.incluirSemNota
  );
}

export function salvarFiltros(f: FiltrosSalvos): void {
  localStorage.setItem(FILTROS_KEY, JSON.stringify(f));
}

/** Grava só a busca, preservando o resto (usado pela tela da obra, que não
 * mantém os demais filtros em estado). */
export function salvarBusca(texto: string): void {
  salvarFiltros({ ...lerFiltrosSalvos(), busca: texto });
}

export function limparFiltrosSalvos(): void {
  salvarFiltros(FILTROS_PADRAO);
}

/** Capa ausente: cobre null e string vazia (obras importadas trazem ''). */
export function semCapa(o: Obra): boolean {
  return !o.capa_url || o.capa_url.trim() === '';
}

/**
 * Mesmo pipeline de filtro + ordenação usado na lista principal — reaproveitado
 * pela tela da obra pro botão Next respeitar os filtros/ordenação ativos.
 *
 * `obraFixada` (Edit mode, Handout 2 follow-up): quando informado, essa obra
 * passa direto por todos os filtros — ela não pode sumir da lista enquanto
 * tem um modal de edição aberto no card, mesmo que a própria edição faça a
 * obra deixar de bater um filtro ativo (ex.: ganhar uma fonte com "Unsourced"
 * ligado). Ainda entra na ordenação normal.
 */
export function obrasFiltradasOrdenadas(
  obras: Obra[],
  fontesPorObra: Map<string, Fonte[]>,
  filtros: FiltrosSalvos,
  ordenacao: Ordenacao,
  obraFixada?: string | null
): Obra[] {
  const buscaLower = filtros.busca.trim().toLowerCase();
  const statusLeituraEntradas = Object.entries(filtros.statusLeituraFiltros).filter(
    ([, v]) => v !== 'off'
  ) as [string, EstadoFiltro][];
  const semFonte = (o: Obra) => (fontesPorObra.get(o.id)?.length ?? 0) === 0;

  /** Nota (score) + toggle "incluir sem nota": independente do gap-chip
   * filtroSemNota (que é um "somente sem nota" exclusivo) — os dois podem
   * coexistir sem conflito. */
  function passaFiltroScore(o: Obra): boolean {
    if (filtros.scoresSel.length === 0 && !filtros.incluirSemNota) return true;
    const bateEstrela = o.score != null && filtros.scoresSel.includes(o.score);
    const bateSemNota = filtros.incluirSemNota && o.score == null;
    return bateEstrela || bateSemNota;
  }

  function passaTodosOsFiltros(o: Obra): boolean {
    return (
      (!buscaLower ||
        o.titulo.toLowerCase().includes(buscaLower) ||
        (o.titulos_alternativos ?? []).some((t) => t.toLowerCase().includes(buscaLower))) &&
      (!filtros.tipo || o.tipo === filtros.tipo) &&
      statusLeituraEntradas.every(([valor, estado]) => passaFiltro(estado, o.status_leitura === valor)) &&
      (!filtros.statusPublicacao || o.status_publicacao === filtros.statusPublicacao) &&
      filtros.generosSel.every((g) => (o.generos ?? []).includes(g)) &&
      filtros.tagsSel.every((t) => (o.tags ?? []).includes(t)) &&
      passaFiltro(filtros.filtroFavorito, o.favorito) &&
      passaFiltro(filtros.filtroNovoCapitulo, temNovoCapitulo(o)) &&
      passaFiltro(filtros.filtroNovel, familiaDeTipo(o.tipo) === 'novel') &&
      passaFiltro(filtros.filtroUnsourced, semFonte(o)) &&
      passaFiltro(filtros.filtroSemCapa, semCapa(o)) &&
      passaFiltro(filtros.filtroSemNu, !o.novelupdates_url) &&
      passaFiltro(filtros.filtroSemNota, o.score == null) &&
      passaFiltro(filtros.filtroSemTipo, !o.tipo) &&
      passaFiltro(filtros.filtroR15, o.classificacao === 'R-15') &&
      passaFiltro(filtros.filtroR18, o.classificacao === 'R-18') &&
      passaFiltroScore(o)
    );
  }

  return obras
    .filter((o) => o.id === obraFixada || passaTodosOsFiltros(o))
    .sort((a, b) => comparar(a, b, ordenacao));
}
