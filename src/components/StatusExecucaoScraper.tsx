import type { ScraperRun } from '../types';

function formatarDataHora(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
}

const LABEL: Record<ScraperRun['status'], string> = {
  rodando: 'Running…',
  concluido: 'Done',
  erro: 'Error',
};

const CLASSE: Record<ScraperRun['status'], string> = {
  rodando: 'execucao-rodando',
  concluido: 'execucao-ok',
  erro: 'execucao-erro',
};

export function StatusExecucaoScraper({
  run,
  carregando,
  erro,
}: {
  run: ScraperRun | null;
  carregando: boolean;
  erro: string | null;
}) {
  if (carregando) return <p className="execucao-status">Loading status…</p>;
  if (erro) return <p className="execucao-status execucao-erro">Error fetching status: {erro}</p>;
  if (!run) return <p className="execucao-status">No runs recorded yet.</p>;

  return (
    <div className={`execucao-status ${CLASSE[run.status]}`}>
      <p>
        <strong>{LABEL[run.status]}</strong> — started at {formatarDataHora(run.iniciado_em)}
        {run.finalizado_em && `, finished at ${formatarDataHora(run.finalizado_em)}`}
      </p>
      {run.mensagem && <p className="execucao-mensagem">{run.mensagem}</p>}
    </div>
  );
}
