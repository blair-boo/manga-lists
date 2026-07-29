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

export type Ordenacao = 'titulo' | 'atualizado' | 'nota' | 'atrasados' | 'criado';

export const ORDENACOES: { valor: Ordenacao; rotulo: string }[] = [
  { valor: 'titulo', rotulo: 'Title (A–Z)' },
  { valor: 'atualizado', rotulo: 'Recently updated' },
  { valor: 'atrasados', rotulo: 'Most chapters behind' },
  { valor: 'nota', rotulo: 'Highest rating' },
  { valor: 'criado', rotulo: 'Recently added' },
];

export function lerOrdenacaoSalva(): Ordenacao {
  const v = localStorage.getItem('ordenacao');
  return ORDENACOES.some((o) => o.valor === v) ? (v as Ordenacao) : 'titulo';
}

export function comparar(a: Obra, b: Obra, ordem: Ordenacao): number {
  switch (ordem) {
    case 'atualizado':
      return (b.atualizado_em ?? '').localeCompare(a.atualizado_em ?? '');
    case 'criado':
      return (b.criado_em ?? '').localeCompare(a.criado_em ?? '');
    case 'nota':
      return (b.nota ?? -1) - (a.nota ?? -1) || a.titulo.localeCompare(b.titulo);
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
  filtroNovoCapitulo: EstadoFiltro;
  filtroNovel: EstadoFiltro;
  filtroUnsourced: EstadoFiltro;
}

export const FILTROS_PADRAO: FiltrosSalvos = {
  busca: '',
  tipo: '',
  statusLeituraFiltros: {},
  statusPublicacao: '',
  generosSel: [],
  tagsSel: [],
  filtroNovoCapitulo: 'off',
  filtroNovel: 'off',
  filtroUnsourced: 'off',
};

export function lerFiltrosSalvos(): FiltrosSalvos {
  try {
    const bruto = localStorage.getItem(FILTROS_KEY);
    if (!bruto) return FILTROS_PADRAO;
    const dados = JSON.parse(bruto) as Partial<FiltrosSalvos>;
    const statusLeituraFiltros: Record<string, EstadoFiltro> = {};
    for (const [k, v] of Object.entries(dados.statusLeituraFiltros ?? {})) {
      statusLeituraFiltros[k] = estadoFiltroValido(v);
    }
    return {
      busca: typeof dados.busca === 'string' ? dados.busca : FILTROS_PADRAO.busca,
      tipo: typeof dados.tipo === 'string' ? dados.tipo : FILTROS_PADRAO.tipo,
      statusLeituraFiltros,
      statusPublicacao: typeof dados.statusPublicacao === 'string' ? dados.statusPublicacao : FILTROS_PADRAO.statusPublicacao,
      generosSel: Array.isArray(dados.generosSel) ? dados.generosSel : FILTROS_PADRAO.generosSel,
      tagsSel: Array.isArray(dados.tagsSel) ? dados.tagsSel : FILTROS_PADRAO.tagsSel,
      filtroNovoCapitulo: estadoFiltroValido(dados.filtroNovoCapitulo),
      filtroNovel: estadoFiltroValido(dados.filtroNovel),
      filtroUnsourced: estadoFiltroValido(dados.filtroUnsourced),
    };
  } catch {
    return FILTROS_PADRAO;
  }
}

/** Mesmo pipeline de filtro + ordenação usado na lista principal — reaproveitado
 * pela tela da obra pro botão Next respeitar os filtros/ordenação ativos. */
export function obrasFiltradasOrdenadas(
  obras: Obra[],
  fontesPorObra: Map<string, Fonte[]>,
  filtros: FiltrosSalvos,
  ordenacao: Ordenacao
): Obra[] {
  const buscaLower = filtros.busca.trim().toLowerCase();
  const statusLeituraEntradas = Object.entries(filtros.statusLeituraFiltros).filter(
    ([, v]) => v !== 'off'
  ) as [string, EstadoFiltro][];
  const semFonte = (o: Obra) => (fontesPorObra.get(o.id)?.length ?? 0) === 0;

  return obras
    .filter(
      (o) =>
        !buscaLower ||
        o.titulo.toLowerCase().includes(buscaLower) ||
        (o.titulos_alternativos ?? []).some((t) => t.toLowerCase().includes(buscaLower))
    )
    .filter((o) => !filtros.tipo || o.tipo === filtros.tipo)
    .filter((o) =>
      statusLeituraEntradas.every(([valor, estado]) => passaFiltro(estado, o.status_leitura === valor))
    )
    .filter((o) => !filtros.statusPublicacao || o.status_publicacao === filtros.statusPublicacao)
    .filter((o) => filtros.generosSel.every((g) => (o.generos ?? []).includes(g)))
    .filter((o) => filtros.tagsSel.every((t) => (o.tags ?? []).includes(t)))
    .filter((o) => passaFiltro(filtros.filtroNovoCapitulo, temNovoCapitulo(o)))
    .filter((o) => passaFiltro(filtros.filtroNovel, familiaDeTipo(o.tipo) === 'novel'))
    .filter((o) => passaFiltro(filtros.filtroUnsourced, semFonte(o)))
    .sort((a, b) => comparar(a, b, ordenacao));
}
