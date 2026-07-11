import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/localDb';
import type { Categoria } from '../types';

export function useListasPorCategoria(categoria: Categoria): string[] {
  const rows = useLiveQuery(() => db.listas.where('categoria').equals(categoria).toArray(), [categoria]);
  return (rows ?? []).map((r) => r.valor);
}
