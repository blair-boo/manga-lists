const SITE_POR_DOMINIO: Record<string, string> = {
  'ezmanga.org': 'ezmanga',
  'nyxscans.com': 'nyxscans',
};

/**
 * Extrai o domínio (host sem "www.") de uma URL. Retorna '' se for inválida.
 */
export function dominioDeUrl(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return '';
  }
}

/** Título aproximado da obra no site, derivado do slug da URL (para conferência). */
export function tituloNoSite(url: string): string {
  try {
    const seg = new URL(url, 'https://x.invalid').pathname.split('/').filter(Boolean).pop() ?? '';
    return decodeURIComponent(seg).replace(/[-_]+/g, ' ').trim();
  } catch {
    return '';
  }
}

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
