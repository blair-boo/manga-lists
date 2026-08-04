import { supabase } from './supabaseClient';
import { normalizarComix, validarUrlComix, type ComixObra } from './comix';

/**
 * Busca uma obra do comix.to pela Edge Function `comix-fetch` (o HTML do site
 * não manda CORS, então o navegador não consegue buscar direto) e devolve o
 * payload já normalizado.
 */
export async function buscarObraComix(entrada: string): Promise<ComixObra> {
  const url = validarUrlComix(entrada);
  if (!url) throw new Error('Not a valid comix.to title URL.');
  const { data, error } = await supabase.functions.invoke('comix-fetch', { body: { url } });
  if (error) throw error;
  return normalizarComix((data as { detalhe: unknown }).detalhe);
}
