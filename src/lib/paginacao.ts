const TAMANHO_PAGINA = 1000;

/**
 * Busca TODAS as linhas de uma query, paginando em lotes de TAMANHO_PAGINA.
 *
 * O PostgREST/Supabase trunca em `db-max-rows` (1000) **em silêncio**: um
 * `select()` sem paginação numa tabela maior devolve menos linhas do que
 * existem, sem erro e sem aviso. Já causou dois bugs reais aqui:
 * `pullFontes()` deixou de enxergar as fontes mais recentes quando `fontes`
 * passou de 1000 linhas, e o estágio de capítulos do scraper varria só 1000
 * das 1448 fontes aprovadas.
 *
 * `query` PRECISA vir com `.order(...)` numa coluna estável: `.range()` é só
 * offset/limit, então sem ORDER BY as páginas não são deterministicamente
 * complementares (linhas se repetem ou somem entre uma página e a seguinte).
 *
 * A contrapartida `buscar_todas` do scraper Python vive em scraper/common.py.
 */
export async function buscarTudoPaginado<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const todas: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await query(from, from + TAMANHO_PAGINA - 1);
    if (error) throw error;
    const linhas = data ?? [];
    todas.push(...linhas);
    if (linhas.length < TAMANHO_PAGINA) break;
    from += TAMANHO_PAGINA;
  }
  return todas;
}
