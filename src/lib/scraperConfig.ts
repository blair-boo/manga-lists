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

// --- Blacklist de domínios (dominios_bloqueados) ---------------------------
// Escreve/lê direto no Supabase (fora do Dexie/sync) — essas tabelas de
// configuração do scraper não são offline-first, igual ao scraper-control.

export interface DominioBloqueado {
  id: string;
  dominio: string;
  motivo: string | null;
  criado_em: string;
}

export async function listarDominiosBloqueados(): Promise<DominioBloqueado[]> {
  const { data, error } = await supabase
    .from('dominios_bloqueados')
    .select('*')
    .order('criado_em', { ascending: false });
  if (error) throw error;
  return (data ?? []) as DominioBloqueado[];
}

/**
 * Adiciona um domínio à blacklist. A descoberta de fontes (discover_fontes.py)
 * passa a ignorá-lo no fallback de busca web. Idempotente.
 */
export async function adicionarDominioBloqueado(dominio: string, motivo?: string): Promise<void> {
  if (!dominio) return;
  const { error } = await supabase
    .from('dominios_bloqueados')
    .upsert({ dominio, motivo: motivo ?? null }, { onConflict: 'dominio' });
  if (error) throw error;
}

export async function removerDominioBloqueado(dominio: string): Promise<void> {
  const { error } = await supabase.from('dominios_bloqueados').delete().eq('dominio', dominio);
  if (error) throw error;
}

/**
 * Quando a usuária insere manualmente uma fonte de um domínio ainda não
 * cadastrado em `sites_suportados`, registra esse domínio automaticamente (já
 * aprovado, pois houve ação humana explícita). Entra com `ativo=false` — sem
 * varredura automática por padrão, já que não se sabe se o site permite fetch
 * direto; a usuária pode ligar depois. Best-effort: silencioso em erro/offline.
 */
export async function registrarDominioManual(url: string): Promise<void> {
  const dominio = dominioDeUrl(url);
  if (!dominio) return;
  try {
    const { data } = await supabase.from('sites_suportados').select('nome, url_base');
    const conhecidos = new Set<string>();
    for (const s of data ?? []) {
      if (s.nome) conhecidos.add(String(s.nome).toLowerCase());
      const h = dominioDeUrl(s.url_base ?? '');
      if (h) conhecidos.add(h);
    }
    if (conhecidos.has(dominio)) return;

    let origin = `https://${dominio}`;
    try {
      origin = new URL(url).origin;
    } catch {
      /* usa o fallback */
    }
    await supabase
      .from('sites_suportados')
      .insert({ nome: dominio, url_base: origin, estrategia: 'fetch_direto', ativo: false });
  } catch {
    /* best-effort: não bloqueia o cadastro da fonte */
  }
}

// --- Limiares de match de título (configuracoes_scraper) --------------------

export interface LimiaresOperacao {
  limiar_auto_aprovacao: number;
  limiar_minimo_pendencia: number;
}

export interface MatchConfig {
  atualizar_obras: LimiaresOperacao;
  buscar_novas_fontes: LimiaresOperacao;
}

export const MATCH_CONFIG_PADRAO: MatchConfig = {
  atualizar_obras: { limiar_auto_aprovacao: 0.95, limiar_minimo_pendencia: 0.7 },
  buscar_novas_fontes: { limiar_auto_aprovacao: 0.95, limiar_minimo_pendencia: 0.85 },
};

export async function getMatchConfig(): Promise<MatchConfig> {
  const { data, error } = await supabase
    .from('configuracoes_scraper')
    .select('valor')
    .eq('chave', 'match_titulo')
    .maybeSingle();
  if (error) throw error;
  const valor = data?.valor as MatchConfig | undefined;
  return valor ?? MATCH_CONFIG_PADRAO;
}

export async function setMatchConfig(valor: MatchConfig): Promise<void> {
  const { error } = await supabase
    .from('configuracoes_scraper')
    .upsert(
      { chave: 'match_titulo', valor, atualizado_em: new Date().toISOString() },
      { onConflict: 'chave' }
    );
  if (error) throw error;
}
