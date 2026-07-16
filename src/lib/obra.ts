import type { FamiliaTipo, Obra, Tipo } from '../types';

/**
 * Mapeia `obra.tipo` (Manga/Manwha/Manhua/Novel) pra família 'manga'/'novel',
 * usada para comparar com o tipo detectado de uma fonte (handout consolidado,
 * Bloco B0/B1). Manga/Manwha/Manhua não se distinguem aqui.
 */
export function familiaDeTipo(tipo: Tipo | null): FamiliaTipo | null {
  if (tipo === 'Novel') return 'novel';
  if (tipo === 'Manga' || tipo === 'Manwha' || tipo === 'Manhua') return 'manga';
  return null;
}

/**
 * Indica se o scraper confirmou um capítulo mais novo do que o já lido.
 * Usado tanto no card quanto no filtro/ordenação da lista principal.
 */
export function temNovoCapitulo(obra: Obra): boolean {
  return (
    obra.ultimo_capitulo_via_scraper &&
    obra.ultimo_capitulo_lancado != null &&
    obra.capitulo_atual != null &&
    obra.ultimo_capitulo_lancado > obra.capitulo_atual
  );
}

/**
 * Quantos capítulos lançados ainda não foram lidos (0 quando não há dados
 * suficientes ou está em dia). Usado para ordenar por "mais atrasadas".
 */
export function capitulosAtrasados(obra: Obra): number {
  if (obra.ultimo_capitulo_lancado == null || obra.capitulo_atual == null) return 0;
  return Math.max(0, obra.ultimo_capitulo_lancado - obra.capitulo_atual);
}
