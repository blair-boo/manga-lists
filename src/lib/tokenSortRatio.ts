import { normalizarTitulo } from './duplicatas';

/** Maior subsequência comum (LCS) entre duas strings, em número de caracteres. */
function lcsLength(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return 0;
  let prev = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    const curr = new Array(m + 1).fill(0);
    for (let j = 1; j <= m; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[m];
}

/**
 * Similaridade entre duas strings (0 a 1), no mesmo espírito do `fuzz.ratio`
 * do rapidfuzz (distância Indel: só insere/remove, sem substituir) — duas
 * vezes o tamanho do maior trecho em comum, dividido pela soma dos tamanhos.
 */
function ratio(a: string, b: string): number {
  const total = a.length + b.length;
  if (total === 0) return 1;
  return (2 * lcsLength(a, b)) / total;
}

/**
 * Porta em JS do `fuzz.token_sort_ratio` do rapidfuzz (o scraper Python usa o
 * original em scraper/match_titulo.py): ordena as palavras de cada string
 * antes de comparar, pra não penalizar títulos com as mesmas palavras em
 * ordem diferente (ex.: "Forgotten Field, The" vs. "The Forgotten Field").
 * Reaproveita `normalizarTitulo` (mesma normalização de acento/caixa/pontuação
 * já usada na detecção de duplicata) em vez de reimplementar.
 */
export function tokenSortRatio(a: string, b: string): number {
  const ordenar = (s: string) =>
    normalizarTitulo(s)
      .split(' ')
      .filter(Boolean)
      .sort()
      .join(' ');
  return ratio(ordenar(a), ordenar(b));
}
