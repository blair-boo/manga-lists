import { supabase } from './supabaseClient';
import { db } from '../db/localDb';
import type { Categoria, ListaItem } from '../types';

/**
 * Insere um novo valor em `listas` (categoria/valor). Grava direto no
 * Supabase — mesma tabela de configuração fora do Dexie/sync, no padrão de
 * scraperConfig.ts — e espelha no Dexie local na hora, pra o TagPicker
 * refletir o valor novo sem esperar o próximo ciclo de sync (handout comix,
 * Bloco E5: aceitar um gênero/tag novo na importação precisa aparecer de
 * imediato). Idempotente via upsert (categoria, valor únicos).
 */
export async function adicionarValorLista(categoria: Categoria, valor: string): Promise<void> {
  const limpo = valor.trim();
  if (!limpo) return;
  const { data, error } = await supabase
    .from('listas')
    .upsert({ categoria, valor: limpo }, { onConflict: 'categoria,valor' })
    .select()
    .single();
  if (error) throw error;
  await db.listas.put(data as ListaItem);
}
