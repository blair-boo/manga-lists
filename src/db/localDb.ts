import Dexie, { type EntityTable } from 'dexie';
import type {
  Fonte,
  ListaItem,
  Obra,
  ReaderCapitulo,
  ReaderFonte,
  ReaderObra,
  SyncQueueItem,
} from '../types';

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
  // Os nomes destas tabelas TÊM que ser iguais aos do Supabase: applyMutation
  // (sync.ts) faz `supabase.from(item.entity)` direto com o nome da entidade.
  reader_obras!: EntityTable<ReaderObra, 'id'>;
  reader_fontes!: EntityTable<ReaderFonte, 'id'>;
  reader_capitulos!: EntityTable<ReaderCapitulo, 'id'>;

  constructor() {
    super('manga-lists');
    this.version(1).stores({
      obras: 'id, titulo, tipo, status_leitura, status_publicacao, atualizado_em',
      fontes: 'id, obra_id, status_aprovacao',
      listas: 'id, categoria',
      syncQueue: '++id, entity, recordId, createdAt',
      meta: 'key',
    });
    // v2 declara SÓ as tabelas novas — o Dexie funde este bloco sobre o v1, que
    // precisa continuar aqui: apagá-lo zeraria as instalações existentes.
    this.version(2).stores({
      reader_obras: 'id, obra_id, concluido, estado, atualizado_em',
      reader_fontes: 'id, reader_obra_id, ordem',
      reader_capitulos: 'id, reader_obra_id, obra_id, estado, disponivel_em',
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
