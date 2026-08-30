/** Chave em `configuracoes_scraper` — espelha CHAVE_ALERTA_SCRAPING_API (scraper/common.py). */
export const CHAVE_ALERTA_SCRAPING_API = 'scraping_api_alerta';

export interface AlertaScrapingApi {
  /** Domínios que ficaram bloqueados no acesso direto e precisam do caminho pago. */
  hosts: string[];
  /** Quando a run mais recente detectou (ISO), ou null se o registro veio sem data. */
  detectadoEm: string | null;
}

/**
 * Traduz o jsonb gravado por `registrar_alerta_scraping_api` (scraper/common.py)
 * no que a tela precisa. Formato salvo, uma chave por estágio:
 *
 *   { "capitulos": { "hosts": {"comix.to": "HTTP 403 …"}, "em": "2026-…" }, … }
 *
 * Devolve null quando nada precisa de renovação — é o caso normal, com os
 * providers em stand-by e os sites respondendo direto. Este módulo é puro
 * (sem rede/banco) pra ser testável direto — a leitura mora no componente,
 * mesmo arranjo de obra.ts (puro) x salvarObra.ts (grava).
 */
export function interpretarAlerta(valor: unknown): AlertaScrapingApi | null {
  if (!valor || typeof valor !== 'object') return null;

  const hosts = new Set<string>();
  let detectadoEm: string | null = null;

  for (const entrada of Object.values(valor as Record<string, unknown>)) {
    if (!entrada || typeof entrada !== 'object') continue;
    const { hosts: hostsDaOrigem, em } = entrada as { hosts?: unknown; em?: unknown };
    if (!hostsDaOrigem || typeof hostsDaOrigem !== 'object') continue;

    const nomes = Object.keys(hostsDaOrigem as Record<string, unknown>);
    if (nomes.length === 0) continue; // estágio rodou limpo: não contribui
    for (const nome of nomes) hosts.add(nome);

    // Mais recente entre os estágios que ainda acusam bloqueio.
    if (typeof em === 'string' && (detectadoEm === null || em > detectadoEm)) detectadoEm = em;
  }

  if (hosts.size === 0) return null;
  return { hosts: [...hosts].sort(), detectadoEm };
}
