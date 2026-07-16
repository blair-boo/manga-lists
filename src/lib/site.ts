const SITE_POR_DOMINIO: Record<string, string> = {
  'ezmanga.org': 'ezmanga',
  'nyxscans.com': 'nyxscans',
};

/**
 * Deriva o slug de `site` a partir do host da URL, pra bater com `sites_suportados.nome`.
 * Para domínios sem mapeamento conhecido, usa o host completo (ex.: 'coolscans.net'),
 * igual ao que `registrarDominioManual` grava em `sites_suportados.nome` — evita a
 * fonte ficar com um `site` que não bate com o domínio registrado.
 */
export function deriveSite(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return SITE_POR_DOMINIO[host] ?? host;
  } catch {
    return null;
  }
}
