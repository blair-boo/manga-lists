import { supabase } from './supabaseClient';
import type { ScraperTipo } from '../types';

export type ScraperAcao = 'start' | 'stop';

/** Chama a Edge Function que dispara/cancela o workflow do GitHub Actions com segurança (token fica só no servidor). */
export async function controlarScraper(alvo: ScraperTipo, acao: ScraperAcao): Promise<void> {
  const { error } = await supabase.functions.invoke('scraper-control', { body: { acao, alvo } });
  if (error) throw error;
}
