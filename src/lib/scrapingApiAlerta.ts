/** Chave em `configuracoes_scraper` — espelha CHAVE_ALERTA_SCRAPING_API (scraper/common.py). */
export const CHAVE_ALERTA_SCRAPING_API = 'scraping_api_alerta';

export interface HostBloqueado {
  host: string;
  /** Por que a run entendeu que o caminho pago faz falta ali: bloqueio explícito
   *  (403/challenge) ou queda em massa de capítulos encontrados. */
  motivo: string;
}

export interface AlertaScrapingApi {
  /** Domínios que precisam do caminho pago, com o motivo de cada um. */
  hosts: HostBloqueado[];
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

  const porHost = new Map<string, string>();
  let detectadoEm: string | null = null;

  for (const entrada of Object.values(valor as Record<string, unknown>)) {
    if (!entrada || typeof entrada !== 'object') continue;
    const { hosts: hostsDaOrigem, em } = entrada as { hosts?: unknown; em?: unknown };
    if (!hostsDaOrigem || typeof hostsDaOrigem !== 'object') continue;

    const entradas = Object.entries(hostsDaOrigem as Record<string, unknown>);
    if (entradas.length === 0) continue; // estágio rodou limpo: não contribui
    for (const [host, motivo] of entradas) {
      // Primeiro motivo vence: o mesmo host pode aparecer em dois estágios.
      if (!porHost.has(host)) porHost.set(host, typeof motivo === 'string' ? motivo : 'blocked');
    }

    // Mais recente entre os estágios que ainda acusam bloqueio.
    if (typeof em === 'string' && (detectadoEm === null || em > detectadoEm)) detectadoEm = em;
  }

  if (porHost.size === 0) return null;
  const hosts = [...porHost.entries()]
    .map(([host, motivo]) => ({ host, motivo }))
    .sort((a, b) => a.host.localeCompare(b.host));
  return { hosts, detectadoEm };
}
