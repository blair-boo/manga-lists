import { supabase } from './supabaseClient';

export type ScraperAcao = 'start' | 'stop';

/** Chama a Edge Function que dispara/cancela o workflow do GitHub Actions com segurança (token fica só no servidor). */
export async function controlarScraperFontes(acao: ScraperAcao): Promise<void> {
  const { error } = await supabase.functions.invoke('scraper-control', { body: { acao } });
  if (error) throw error;
}
