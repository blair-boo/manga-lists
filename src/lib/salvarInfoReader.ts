import { updateReaderObra, type NovaObra, type NovaReaderObra } from '../db/repo';
import { COLUNA_OVERRIDE, ORIGEM_NA_OBRA } from './reader';
import { salvarCamposObra } from './salvarObra';
import type { CampoInfoReader, Obra, ReaderObra } from '../types';

/**
 * Grava a página de informações do Reader. Sempre atualiza o registro do
 * Reader; além disso, cada campo marcado em `espelhar` também grava no cadastro
 * da obra via `salvarCamposObra`, que já cuida do rename da capa e do
 * espelhamento manga<->novel existente — por isso não há uma segunda máquina de
 * espelhamento aqui.
 *
 * Mão única de propósito: editar a obra pela tela dela NÃO volta pro Reader.
 * Se voltasse, um override deixaria de ser um override.
 *
 * Mesmo arranjo de salvarObra.ts: a lógica pura (o que herda de quê) fica em
 * reader.ts, testável; este módulo só grava.
 */
export async function salvarInfoReader(
  reader: ReaderObra,
  obra: Obra | undefined,
  changes: Partial<NovaReaderObra>,
  espelhar: Partial<Record<CampoInfoReader, boolean>>
): Promise<void> {
  await updateReaderObra(reader.id, { ...changes, espelhar });

  if (!obra) return;
  const patchObra: Partial<NovaObra> = {};
  for (const campo of Object.keys(COLUNA_OVERRIDE) as CampoInfoReader[]) {
    if (!espelhar[campo]) continue;
    const coluna = COLUNA_OVERRIDE[campo];
    if (!(coluna in changes)) continue;
    (patchObra as Record<string, unknown>)[ORIGEM_NA_OBRA[campo]] = changes[coluna];
  }
  if (Object.keys(patchObra).length > 0) await salvarCamposObra(obra, patchObra);
}
