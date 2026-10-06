import type { ScraperRun } from '../types';

export const MENSAGEM_PARADA_MANUAL = 'Stopped manually';

/**
 * Aviso condicional da busca de novas fontes. Run travada tem prioridade; erro
 * só avisa quando não foi parada intencional (botão Stop).
 */
export function avisoDaRun(run: ScraperRun | null, travada: boolean): string | null {
  if (!run) return null;
  if (travada) {
    return 'The previous run looks stuck (it never finished). Starting a new search will mark it as stopped.';
  }
  if (run.status === 'erro' && run.mensagem !== MENSAGEM_PARADA_MANUAL) {
    return 'The last search ended with an error (details below). You can start a new search.';
  }
  return null;
}
