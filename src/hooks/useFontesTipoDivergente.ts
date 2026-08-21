import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '../db/localDb';
import { listarFontesTipoDivergente, type FonteTipoDivergente } from '../lib/fonteTipo';

/** Fontes reativas cujo tipo diverge da obra atual — base da fila "Mismatched source types". */
export function useFontesTipoDivergente(): FonteTipoDivergente[] | undefined {
  const fontes = useLiveQuery(() => db.fontes.toArray(), []);
  const obras = useLiveQuery(() => db.obras.toArray(), []);

  return useMemo(() => {
    if (!fontes || !obras) return undefined;
    return listarFontesTipoDivergente(fontes, obras);
  }, [fontes, obras]);
}

/** Contagem de obras distintas na fila (não de fontes) — pro badge do banner. */
export function useFontesTipoDivergenteObrasCount(): number {
  const lista = useFontesTipoDivergente();
  return useMemo(() => new Set((lista ?? []).map((d) => d.obraAtual.id)).size, [lista]);
}
