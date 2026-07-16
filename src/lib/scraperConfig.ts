import { supabase } from './supabaseClient';
import { controlarScraper } from './scraperControl';

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

// --- Aprovação de domínio (dois eixos independentes, handout consolidado Bloco C) ---
//
// "A fonte existe" (link clicável na obra) e "o domínio está aprovado para
// scraping" (sites_suportados.ativo=true, runs automáticas podem visitá-lo)
// são decisões separadas. Inserir uma fonte manual NUNCA aprova o domínio
// sozinho — só cria (se for novo) um pedido pendente (`ativo=false`), que fica
// na fila de aprovação da página de Updates até a usuária decidir.

function origemDeUrl(url: string, dominio: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return `https://${dominio}`;
  }
}

/**
 * Quando a usuária insere manualmente uma fonte de um domínio ainda não
 * cadastrado em `sites_suportados`, registra um PEDIDO de aprovação
 * (`ativo=false`, sem adaptador) — nunca aprova sozinho. Domínio já
 * conhecido (aprovado ou já pendente) não gera pedido novo. Best-effort:
 * silencioso em erro/offline, nunca bloqueia o cadastro da fonte.
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
    if (conhecidos.has(dominio)) return; // já aprovado ou já pendente: sem pedido novo

    await supabase
      .from('sites_suportados')
      .insert({ nome: dominio, url_base: origemDeUrl(url, dominio), estrategia: 'fetch_direto', ativo: false });
  } catch {
    /* best-effort: não bloqueia o cadastro da fonte */
  }
}

export interface DominioPendente {
  id: string;
  nome: string;
  url_base: string | null;
  criado_em: string | null;
}

/** Domínios aguardando decisão (ativo=false): pedidos vindos do cadastro manual de fonte. */
export async function listarDominiosPendentes(): Promise<DominioPendente[]> {
  const { data, error } = await supabase
    .from('sites_suportados')
    .select('id, nome, url_base, criado_em')
    .eq('ativo', false)
    .order('nome');
  if (error) throw error;
  return (data ?? []) as DominioPendente[];
}

/** Aprova um domínio pendente: vira ativo, sai de eventual blacklist, e dispara a detecção de adaptador. */
export async function aprovarDominio(id: string, nome: string): Promise<void> {
  const { error } = await supabase.from('sites_suportados').update({ ativo: true }).eq('id', id);
  if (error) throw error;
  await removerDominioBloqueado(nome).catch(() => {});
  try {
    await controlarScraper('designar', 'start');
  } catch {
    /* best-effort: a detecção pode ser reexecutada depois pelo botão manual */
  }
}

/** Rejeita um domínio pendente: manda pra blacklist (nunca mais sugerido) e mantém inativo. */
export async function rejeitarDominio(nome: string, motivo?: string): Promise<void> {
  await adicionarDominioBloqueado(nome, motivo ?? 'Domain approval rejected');
}

export type ResultadoAdicaoDominio = 'ja_aprovado' | 'ativado' | 'criado';

/**
 * Inserção manual de domínio seguro direto na página de Updates (handout
 * consolidado C5): aprova de largada (sem depender de ter cadastrado uma
 * fonte antes), reativa um domínio antes rejeitado (removendo da blacklist),
 * e nunca duplica um domínio já aprovado.
 */
export async function adicionarDominioSeguro(entrada: string): Promise<ResultadoAdicaoDominio> {
  const url = /^https?:\/\//i.test(entrada) ? entrada : `https://${entrada}`;
  const dominio = dominioDeUrl(url);
  if (!dominio) throw new Error('Invalid domain/URL');

  const { data } = await supabase.from('sites_suportados').select('id, nome, url_base, ativo');
  const existente = (data ?? []).find(
    (s) => String(s.nome).toLowerCase() === dominio || dominioDeUrl(s.url_base ?? '') === dominio
  );

  if (existente?.ativo) {
    return 'ja_aprovado';
  }

  if (existente) {
    const { error } = await supabase.from('sites_suportados').update({ ativo: true }).eq('id', existente.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('sites_suportados')
      .insert({ nome: dominio, url_base: origemDeUrl(url, dominio), estrategia: 'fetch_direto', ativo: true });
    if (error) throw error;
  }

  await removerDominioBloqueado(dominio).catch(() => {});
  try {
    await controlarScraper('designar', 'start');
  } catch {
    /* best-effort */
  }
  return existente ? 'ativado' : 'criado';
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
