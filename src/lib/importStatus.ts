import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/localDb';

export type TipoImportacao = 'csv' | 'conciliacao';

export interface StatusImportacao {
  tipo: TipoImportacao;
  arquivo: string;
  iniciadoEm: string;
  total: number;
  feito: number;
  concluidoEm: string | null;
  erro: string | null;
}

/** Acima disso, uma importação "em andamento" é tratada como travada (aba fechada
 * no meio, crash) em vez de bloquear a trava pra sempre. */
const LIMITE_TRAVADA_MS = 20 * 60 * 1000;

const CHAVE = 'importStatus';

export const ROTULO_TIPO: Record<TipoImportacao, string> = {
  csv: 'Bulk fill via CSV',
  conciliacao: 'Related sites reconciliation',
};

/** Uma única trava compartilhada entre Bulk fill e Reconciliation — as duas
 * escrevem em obras/fontes em massa, então rodar as duas ao mesmo tempo (ou a
 * mesma duas vezes, em abas diferentes) arrisca conflito. */
export async function lerStatusImportacao(): Promise<StatusImportacao | null> {
  const row = await db.meta.get(CHAVE);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as StatusImportacao;
  } catch {
    return null;
  }
}

export async function salvarStatusImportacao(status: StatusImportacao): Promise<void> {
  await db.meta.put({ key: CHAVE, value: JSON.stringify(status) });
}

/** Live: reflete imports de outras abas do mesmo dispositivo (Dexie propaga
 * mudanças no IndexedDB entre abas), não só desta. */
export function useStatusImportacao(): StatusImportacao | null | undefined {
  return useLiveQuery(() => lerStatusImportacao(), []);
}

export function importacaoEmAndamento(status: StatusImportacao | null | undefined): status is StatusImportacao {
  return !!status && status.concluidoEm === null;
}

/** Uma importação "em andamento" iniciada há tempo demais provavelmente travou
 * (aba fechada, crash) — trata como abandonada em vez de bloquear pra sempre. */
export function importacaoPareceTravada(status: StatusImportacao): boolean {
  return Date.now() - new Date(status.iniciadoEm).getTime() > LIMITE_TRAVADA_MS;
}

/** Devolve o status que deve bloquear um novo import (em andamento e não
 * travado), ou null se está livre pra começar. Único ponto usado por Bulk fill
 * e Reconciliation pra decidir se travam o próprio upload — é o mesmo status
 * compartilhado, então a trava vale nos dois sentidos. */
export function bloqueiaImportacao(status: StatusImportacao | null | undefined): StatusImportacao | null {
  if (!importacaoEmAndamento(status)) return null;
  if (importacaoPareceTravada(status)) return null;
  return status;
}
