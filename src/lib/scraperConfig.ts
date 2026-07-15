import { supabase } from './supabaseClient';

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
 * Adiciona um domínio à blacklist (`dominios_bloqueados`). A descoberta de fontes
 * (discover_fontes.py) passa a ignorar esse domínio no fallback de busca web.
 *
 * Escreve direto no Supabase (fora do Dexie/sync) — essas tabelas de configuração
 * do scraper não são offline-first, igual ao scraper-control. Idempotente: um
 * domínio já presente não gera erro.
 */
export async function adicionarDominioBloqueado(dominio: string, motivo?: string): Promise<void> {
  if (!dominio) return;
  const { error } = await supabase
    .from('dominios_bloqueados')
    .upsert({ dominio, motivo: motivo ?? null }, { onConflict: 'dominio' });
  if (error) throw error;
}
