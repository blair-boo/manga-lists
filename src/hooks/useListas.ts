import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/localDb';
import type { Categoria, ListaItem } from '../types';

export function useListasPorCategoria(categoria: Categoria): string[] {
  const rows = useLiveQuery(() => db.listas.where('categoria').equals(categoria).toArray(), [categoria]);
  return (rows ?? []).map((r) => r.valor);
}

/** Como useListasPorCategoria, mas devolve os itens completos (id incluso) —
 * necessário pra telas de gerenciamento (Settings > Genres/Tags) terem uma
 * chave estável por item enquanto ele está sendo editado/renomeado. */
export function useListaItensPorCategoria(categoria: Categoria): ListaItem[] {
  const rows = useLiveQuery(() => db.listas.where('categoria').equals(categoria).toArray(), [categoria]);
  return rows ?? [];
}
