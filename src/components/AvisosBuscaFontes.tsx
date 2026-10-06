import { avisoDaRun } from '../lib/avisosBuscaFontes';
import type { ScraperRun } from '../types';

/** Avisos da busca de novas fontes: um fixo (duração) e um condicional (última run com erro ou travada). */
export function AvisosBuscaFontes({ run, travada }: { run: ScraperRun | null; travada: boolean }) {
  const aviso = avisoDaRun(run, travada);
  return (
    <>
      <p className="atualizacao-subtitulo-nota">
        The search goes through your whole library and can take hours. You can stop it with "Stop search" and start
        again later; sources found so far are saved as the search goes.
      </p>
      {aviso && <p className="execucao-status execucao-erro">{aviso}</p>}
    </>
  );
}
