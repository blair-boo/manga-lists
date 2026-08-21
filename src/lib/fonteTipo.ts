import { familiaDeTipo } from './obra';
import type { Fonte, Obra } from '../types';

/**
 * Fonte cujo tipo detectado diverge da família da obra a que está presa
 * (Bloco B0/B1) — candidata a mover/criar/descartar via fila de revisão.
 */
export interface FonteTipoDivergente {
  fonte: Fonte;
  obraAtual: Obra;
  /** Obra vinculada já cadastrada cuja família bate com o tipo detectado da fonte, se existir. */
  obraCorrespondente: Obra | null;
}

/**
 * Lista toda fonte cujo `tipo_detectado` diverge da família da obra atual —
 * base da fila "Mismatched source types" em Updates. Puramente derivada (sem
 * campo novo no banco): resolver a divergência (mover/criar/descartar) some
 * o item na próxima chamada; "Keep" não muda nada disso, então o item
 * continua aparecendo até a usuária decidir de fato.
 */
export function listarFontesTipoDivergente(fontes: Fonte[], obras: Obra[]): FonteTipoDivergente[] {
  const obraPorId = new Map(obras.map((o) => [o.id, o]));
  const divergentes: FonteTipoDivergente[] = [];

  for (const fonte of fontes) {
    if (!fonte.tipo_detectado) continue;
    const obraAtual = obraPorId.get(fonte.obra_id);
    if (!obraAtual) continue;

    const familiaObra = familiaDeTipo(obraAtual.tipo);
    if (familiaObra === null || familiaObra === fonte.tipo_detectado) continue;

    const vinculada = obraAtual.obra_vinculada_id ? (obraPorId.get(obraAtual.obra_vinculada_id) ?? null) : null;
    const obraCorrespondente = vinculada && familiaDeTipo(vinculada.tipo) === fonte.tipo_detectado ? vinculada : null;

    divergentes.push({ fonte, obraAtual, obraCorrespondente });
  }

  return divergentes.sort((a, b) => a.obraAtual.titulo.localeCompare(b.obraAtual.titulo));
}
