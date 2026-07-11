import Dexie, { type EntityTable } from 'dexie';
import type { Fonte, ListaItem, Obra, SyncQueueItem } from '../types';

interface MetaItem {
  key: string;
  value: string;
}

class LocalDb extends Dexie {
  obras!: EntityTable<Obra, 'id'>;
  fontes!: EntityTable<Fonte, 'id'>;
  listas!: EntityTable<ListaItem, 'id'>;
  syncQueue!: EntityTable<SyncQueueItem, 'id'>;
  meta!: EntityTable<MetaItem, 'key'>;

  constructor() {
    super('manga-lists');
    this.version(1).stores({
      obras: 'id, titulo, tipo, status_leitura, status_publicacao, atualizado_em',
      fontes: 'id, obra_id, status_aprovacao',
      listas: 'id, categoria',
      syncQueue: '++id, entity, recordId, createdAt',
      meta: 'key',
    });
  }
}

export const db = new LocalDb();

export async function getLastSyncedAt(entity: string): Promise<string | null> {
  const row = await db.meta.get(`lastSyncedAt:${entity}`);
  return row?.value ?? null;
}

export async function setLastSyncedAt(entity: string, iso: string): Promise<void> {
  await db.meta.put({ key: `lastSyncedAt:${entity}`, value: iso });
}

export async function enqueueMutation(item: Omit<SyncQueueItem, 'id' | 'createdAt'>): Promise<void> {
  await db.syncQueue.add({ ...item, createdAt: new Date().toISOString() });
}
