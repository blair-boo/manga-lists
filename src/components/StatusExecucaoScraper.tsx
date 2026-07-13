import type { ScraperRun } from '../types';

function formatarDataHora(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

const LABEL: Record<ScraperRun['status'], string> = {
  rodando: 'Rodando…',
  concluido: 'Concluído',
  erro: 'Erro',
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
  if (carregando) return <p className="execucao-status">Carregando status…</p>;
  if (erro) return <p className="execucao-status execucao-erro">Erro ao consultar status: {erro}</p>;
  if (!run) return <p className="execucao-status">Nenhuma execução registrada ainda.</p>;

  return (
    <div className={`execucao-status ${CLASSE[run.status]}`}>
      <p>
        <strong>{LABEL[run.status]}</strong> — iniciado em {formatarDataHora(run.iniciado_em)}
        {run.finalizado_em && `, finalizado em ${formatarDataHora(run.finalizado_em)}`}
      </p>
      {run.mensagem && <p className="execucao-mensagem">{run.mensagem}</p>}
    </div>
  );
}
