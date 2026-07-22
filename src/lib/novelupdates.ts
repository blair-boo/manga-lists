// Helpers do Novel Updates no cliente (Handout 3, Bloco E). O scraper Python tem
// a mesma lógica; aqui ela é usada ao aprovar um match na fila (E5/E4).

// Scripts não-romanos descartados ao enriquecer Alternative titles (E3):
// Hiragana/Katakana (+ Kana halfwidth), CJK (chinês/kanji) e Hangul (coreano).
const NAO_ROMANO = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿ｦ-ﾟ]/;

/** True se a string não contém nenhum caractere CJK/Hangul/Kana (acentos latinos passam). */
export function ehRomano(s: string): boolean {
  return !NAO_ROMANO.test(s);
}

/**
 * União (sem duplicar, case-insensitive) dos títulos alternativos existentes com
 * os Associated Names romanos (E3/E4). Preserva os existentes e a ordem de chegada.
 */
export function enriquecerTitulosAlternativos(
  existentes: string[] | null,
  associados: string[] | null
): string[] {
  const resultado = [...(existentes ?? [])];
  const ja = new Set(resultado.map((t) => t.trim().toLowerCase()));
  for (const nome of associados ?? []) {
    const limpo = nome.trim();
    if (!limpo || !ehRomano(limpo)) continue;
    const chave = limpo.toLowerCase();
    if (!ja.has(chave)) {
      resultado.push(limpo);
      ja.add(chave);
    }
  }
  return resultado;
}
