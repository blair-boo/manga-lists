import { supabase } from './supabaseClient';
import type { ScraperTipo } from '../types';

export type ScraperAcao = 'start' | 'stop';

/** Chama a Edge Function que dispara/cancela o workflow do GitHub Actions com segurança (token fica só no servidor). */
export async function controlarScraper(alvo: ScraperTipo, acao: ScraperAcao): Promise<void> {
  const { error } = await supabase.functions.invoke('scraper-control', { body: { acao, alvo } });
  if (error) throw error;
}

/**
 * Para uma run manualmente: cancela no GitHub Actions (best-effort — se o job
 * já morreu por conta própria, não há o que cancelar) E, diferente do "stop"
 * puro, também marca a linha em `scraper_runs` como encerrada direto. O
 * cancelamento no GitHub sozinho nunca grava isso — se o processo for morto
 * antes de gravar 'concluido'/'erro' ele fica 'rodando' pra sempre, e o botão
 * Stop parece não fazer nada (era exatamente o bug reportado).
 */
export async function pararScraperManualmente(alvo: ScraperTipo, runId: string): Promise<void> {
  await controlarScraper(alvo, 'stop').catch(() => {
    /* best-effort: segue pra marcar a run mesmo se não havia nada pra cancelar no GitHub */
  });
  const { error } = await supabase
    .from('scraper_runs')
    .update({ status: 'erro', mensagem: 'Stopped manually', finalizado_em: new Date().toISOString() })
    .eq('id', runId)
    .eq('status', 'rodando');
  if (error) throw error;
}
