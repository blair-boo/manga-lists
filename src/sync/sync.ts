import { supabase } from '../lib/supabaseClient';
import { db, getLastSyncedAt, setLastSyncedAt } from '../db/localDb';
import type { Fonte, ListaItem, Obra, SyncQueueItem } from '../types';

let syncing = false;

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

async function applyMutation(item: SyncQueueItem): Promise<void> {
  const table = item.entity;
  if (item.op === 'delete') {
    const { error } = await supabase.from(table).delete().eq('id', item.recordId);
    if (error) throw error;
    return;
  }
  // insert/update: local id já é o uuid definitivo, então upsert cobre os dois casos
  const { error } = await supabase.from(table).upsert(item.payload as unknown as Record<string, unknown>);
  if (error) throw error;
}

/** Envia mutações pendentes da fila local para o Supabase, em ordem. Para no primeiro erro (ex: sem rede). */
export async function pushPending(): Promise<void> {
  const pending = await db.syncQueue.orderBy('createdAt').toArray();
  for (const item of pending) {
    try {
      await applyMutation(item);
      if (item.id !== undefined) {
        await db.syncQueue.delete(item.id);
      }
    } catch (err) {
      console.warn('Falha ao sincronizar mutação pendente, tentando novamente depois', item, err);
      break;
    }
  }
}

/** Puxa obras alteradas no servidor desde a última sync (incremental via atualizado_em). */
async function pullObras(): Promise<void> {
  const since = await getLastSyncedAt('obras');
  let query = supabase.from('obras').select('*').order('atualizado_em', { ascending: true });
  if (since) query = query.gt('atualizado_em', since);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as Obra[];
  if (rows.length > 0) {
    await db.obras.bulkPut(rows);
    await setLastSyncedAt('obras', rows[rows.length - 1].atualizado_em);
  } else if (!since) {
    await setLastSyncedAt('obras', new Date(0).toISOString());
  }
}

/**
 * Puxa fontes do servidor. A tabela `fontes` não tem coluna de atualização
 * (só `criado_em`), e o scraper atualiza `ultimo_capitulo_detectado` in-place
 * sem mudar essa data — então não dá pra fazer pull incremental confiável.
 * Como o volume é pequeno (dezenas/centenas de linhas), full refresh a cada
 * sync é simples e correto.
 */
async function pullFontes(): Promise<void> {
  const { data, error } = await supabase.from('fontes').select('*');
  if (error) throw error;
  const rows = (data ?? []) as Fonte[];
  await db.fontes.clear();
  if (rows.length > 0) await db.fontes.bulkPut(rows);
}

async function pullListas(): Promise<void> {
  const { data, error } = await supabase.from('listas').select('*');
  if (error) throw error;
  const rows = (data ?? []) as ListaItem[];
  await db.listas.clear();
  if (rows.length > 0) await db.listas.bulkPut(rows);
}

/** Roda o ciclo completo: envia pendências, depois puxa mudanças do servidor. Silencioso se offline. */
export async function syncNow(): Promise<{ ok: boolean; error?: unknown }> {
  if (syncing) return { ok: false, error: 'already-syncing' };
  if (!isOnline()) return { ok: false, error: 'offline' };
  syncing = true;
  try {
    await pushPending();
    await pullObras();
    await pullFontes();
    await pullListas();
    return { ok: true };
  } catch (error) {
    console.error('Erro durante sincronização', error);
    return { ok: false, error };
  } finally {
    syncing = false;
  }
}
