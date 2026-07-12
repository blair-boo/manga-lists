const SITE_POR_DOMINIO: Record<string, string> = {
  'ezmanga.org': 'ezmanga',
  'nyxscans.com': 'nyxscans',
};

/** Deriva o slug de `site` a partir do host da URL, pra bater com `sites_suportados.nome`. */
export function deriveSite(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return SITE_POR_DOMINIO[host] ?? host.split('.')[0];
  } catch {
    return null;
  }
}
