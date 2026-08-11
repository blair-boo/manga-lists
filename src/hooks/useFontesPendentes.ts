import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '../db/localDb';
import { fontePertenceAoEscopo } from '../lib/fontesAprovacao';

/** Contagem reativa de fontes pendentes de aprovação num escopo (ver fontePertenceAoEscopo). */
export function useFontesPendentesCount(escopo: 'suportados' | 'novas', sitesSuportados: string[]): number {
  const fontes = useLiveQuery(() => db.fontes.filter((f) => f.descoberta_automaticamente).toArray(), []);
  const suportadosSet = useMemo(() => new Set(sitesSuportados), [sitesSuportados]);

  return useMemo(
    () =>
      (fontes ?? []).filter((f) => f.status_aprovacao === 'pendente' && fontePertenceAoEscopo(f, escopo, suportadosSet))
        .length,
    [fontes, suportadosSet, escopo]
  );
}
