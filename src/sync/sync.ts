import { supabase } from '../lib/supabaseClient';
import { db, getLastSyncedAt, setLastSyncedAt } from '../db/localDb';
import type { Fonte, ListaItem, Obra, SyncQueueItem } from '../types';

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

/**
 * Envia mutações pendentes da fila local para o Supabase, em ordem por
 * registro. Uma mutação que falha (ex.: uma linha com dado inválido) só pula
 * as mutações SEGUINTES do MESMO registro (pra não reenviar fora de ordem) —
 * não trava as de outros registros na fila. Sem isso, uma única linha
 * problemática de uma atualização em massa via CSV bloqueava o envio de
 * TODAS as outras linhas indefinidamente (a fila só reprocessa do início).
 * Retorna quantos registros ficaram com mutação pendente por causa de erro.
 */
export async function pushPending(): Promise<{ falhas: number }> {
  const pending = await db.syncQueue.orderBy('createdAt').toArray();
  const registrosComFalha = new Set<string>();
  for (const item of pending) {
    const chave = `${item.entity}:${item.recordId}`;
    if (registrosComFalha.has(chave)) continue;
    try {
      await applyMutation(item);
      if (item.id !== undefined) {
        await db.syncQueue.delete(item.id);
      }
    } catch (err) {
      console.warn('Falha ao sincronizar mutação pendente, tentando novamente depois', item, err);
      registrosComFalha.add(chave);
    }
  }
  return { falhas: registrosComFalha.size };
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
    // GUARDA: não sobrescrever obras com edição local ainda não sincronizada
    // (insert/update pendente na syncQueue). Sem isso, um pull que traz a versão
    // velha do servidor engoliria uma edição que a usuária acabou de fazer e cujo
    // push ainda não completou (offline, rede lenta) — a edição "sumiria". Mesmo
    // raciocínio da guarda em reconciliarObrasDeletadas. O push envia a versão
    // local depois, e o próximo pull a traz de volta com o timestamp novo.
    const pendentes = await db.syncQueue.where('entity').equals('obras').toArray();
    const protegidos = new Set(pendentes.filter((m) => m.op !== 'delete').map((m) => m.recordId));
    const aAplicar = rows.filter((r) => !protegidos.has(r.id));
    if (aAplicar.length > 0) await db.obras.bulkPut(aAplicar);
    // Avança o watermark pelo maior atualizado_em de TODAS as linhas (inclusive as
    // puladas — a ordenação é asc), pra não re-buscá-las em loop. A linha protegida
    // se reconcilia quando o push dela passar e o pull seguinte a trouxer.
    await setLastSyncedAt('obras', rows[rows.length - 1].atualizado_em);
  } else if (!since) {
    await setLastSyncedAt('obras', new Date(0).toISOString());
  }
}

/**
 * Reconcilia deleções remotas de obras. O pull incremental (via atualizado_em)
 * nunca enxerga linhas apagadas no servidor, então uma obra deletada em outro
 * dispositivo (ou direto no Supabase) ficaria para sempre no IndexedDB local.
 * Busca só os ids do servidor e remove localmente o que não existe mais lá.
 *
 * GUARDA CRÍTICA: ids com mutação insert/update pendente na syncQueue são
 * excluídos da remoção — são obras criadas/alteradas localmente cujo push ainda
 * não chegou ao servidor (ex.: push falhou nesta rodada por rede); apagá-las
 * destruiria dados da usuária. A checagem é feita AQUI, na hora de deletar (não
 * antes), para cobrir mutações enfileiradas no meio do próprio ciclo de sync.
 *
 * Qualquer falha ou resposta parcial aborta a reconciliação silenciosamente:
 * nunca deletar com base em erro ou lista incompleta de ids.
 */
async function reconciliarObrasDeletadas(): Promise<void> {
  let idsServidor: Set<string>;
  try {
    const { data, error, count } = await supabase.from('obras').select('id', { count: 'exact' });
    if (error || !data) return;
    // Resposta parcial (ex.: limite de linhas do PostgREST): reconciliar com uma
    // lista truncada apagaria obras que existem no servidor. Pula.
    if (count !== null && data.length < count) return;
    idsServidor = new Set(data.map((r) => r.id as string));
  } catch {
    return;
  }

  const idsLocais = (await db.obras.toCollection().primaryKeys()) as string[];
  const candidatos = idsLocais.filter((id) => !idsServidor.has(id));
  if (candidatos.length === 0) return;

  const pendentes = await db.syncQueue.where('entity').equals('obras').toArray();
  const protegidos = new Set(pendentes.filter((m) => m.op !== 'delete').map((m) => m.recordId));

  const remover = candidatos.filter((id) => !protegidos.has(id));
  if (remover.length === 0) return;

  await db.obras.bulkDelete(remover);
  await db.fontes.where('obra_id').anyOf(remover).delete();
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

let syncEmAndamento: Promise<{ ok: boolean; error?: unknown }> | null = null;

/**
 * Roda o ciclo completo: envia pendências, depois puxa mudanças do servidor.
 * Silencioso se offline. Chamadas concorrentes (ex.: uma atualização em massa
 * via CSV dispara uma por linha) compartilham a MESMA execução em andamento
 * em vez de virar no-op — antes, só a primeira chamada realmente rodava
 * pushPending e as demais recebiam `{ok: false, error: 'already-syncing'}`
 * sem nunca reagendar o envio das suas próprias mutações, que ficavam presas
 * na fila até o próximo ciclo periódico (5 min).
 */
export function syncNow(): Promise<{ ok: boolean; error?: unknown }> {
  if (syncEmAndamento) return syncEmAndamento;
  if (!isOnline()) return Promise.resolve({ ok: false, error: 'offline' });

  syncEmAndamento = (async () => {
    try {
      const { falhas } = await pushPending();
      await pullObras();
      await reconciliarObrasDeletadas();
      await pullFontes();
      await pullListas();
      return falhas > 0
        ? { ok: false, error: `${falhas} alteração(ões) local(is) não sincronizaram, tentando de novo mais tarde` }
        : { ok: true };
    } catch (error) {
      console.error('Erro durante sincronização', error);
      return { ok: false, error };
    } finally {
      syncEmAndamento = null;
    }
  })();

  return syncEmAndamento;
}
