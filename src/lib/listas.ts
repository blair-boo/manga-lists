import { supabase } from './supabaseClient';
import { db } from '../db/localDb';
import { syncNow } from '../sync/sync';
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

/**
 * Renomeia um valor do catálogo (categoria/valor) via RPC, que também
 * atualiza `obras.generos`/`obras.tags` em todas as obras que o usam (as
 * colunas são arrays soltos, sem FK — a propagação é responsabilidade do
 * banco, ver migration 0020). Se o valor novo já existir, o RPC mescla os
 * dois (a obra fica só com um; a linha antiga do catálogo desaparece).
 * `syncNow()` ao final re-espelha obras/listas no Dexie sem precisar de
 * mirror manual — a mesma sincronização usada em todo o resto do app.
 */
export async function renomearValorLista(categoria: Categoria, valorAntigo: string, valorNovo: string): Promise<void> {
  const limpo = valorNovo.trim();
  if (!limpo || limpo === valorAntigo) return;
  const { error } = await supabase.rpc('renomear_valor_lista', {
    p_categoria: categoria,
    p_valor_antigo: valorAntigo,
    p_valor_novo: limpo,
  });
  if (error) throw error;
  await syncNow();
}

/**
 * Remove um valor do catálogo via RPC, que também remove esse valor de
 * `obras.generos`/`obras.tags` em todas as obras que o usam (ver migration
 * 0020). `syncNow()` ao final re-espelha obras/listas no Dexie.
 */
export async function removerValorLista(categoria: Categoria, valor: string): Promise<void> {
  const { error } = await supabase.rpc('remover_valor_lista', { p_categoria: categoria, p_valor: valor });
  if (error) throw error;
  await syncNow();
}
