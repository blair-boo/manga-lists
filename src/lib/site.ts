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

/**
 * Domínios de catálogo que têm campo dedicado em `obras` (não são "fontes" de
 * leitura — Bloco B0/handout de links). Usado pelo Modo 3 da importação CSV
 * (Conciliação de sites relacionados) pra decidir se um link aprovado grava
 * no campo certo da obra ou vira uma fonte genérica (tabela `fontes`).
 */
const CAMPO_OBRA_POR_DOMINIO: Record<
  string,
  'novelupdates_url' | 'anilist_url' | 'myanimelist_url' | 'mangaupdates_url' | 'mangadex_url' | 'mangabaka_url'
> = {
  'novelupdates.com': 'novelupdates_url',
  'anilist.co': 'anilist_url',
  'myanimelist.net': 'myanimelist_url',
  'mangaupdates.com': 'mangaupdates_url',
  'mangadex.org': 'mangadex_url',
  'mangabaka.dev': 'mangabaka_url',
  'mangabaka.com': 'mangabaka_url',
};

/**
 * Campo dedicado de `obras` para o domínio do link, ou `null` se o domínio
 * não é um catálogo conhecido (nesse caso o link vira uma fonte genérica).
 */
export function campoPorDominio(url: string): (typeof CAMPO_OBRA_POR_DOMINIO)[string] | null {
  return CAMPO_OBRA_POR_DOMINIO[dominioDeUrl(url)] ?? null;
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

/** Compara URLs ignorando barra final e caixa, pra recusar a mesma fonte duas vezes. */
export function urlNormalizada(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '');
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
