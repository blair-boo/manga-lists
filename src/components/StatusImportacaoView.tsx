import { importacaoPareceTravada, ROTULO_TIPO, type StatusImportacao } from '../lib/importStatus';

function formatarDataHora(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
}

/** Mostra o status compartilhado de import (Bulk fill / Reconciliation) — em
 * andamento (com progresso) ou a última execução concluída. Renderizado nas
 * duas seções, então dá pra ver de qualquer uma o que está rodando na outra. */
export function StatusImportacaoView({ status }: { status: StatusImportacao | null | undefined }) {
  if (!status) return null;

  // Checagem direta (não a type guard importacaoEmAndamento): `status` já foi
  // estreitado pra StatusImportacao pelo `if (!status)` acima, e chamar aqui
  // um type guard cujo parâmetro aceita null/undefined faz o TS "estreitar" o
  // ramo negativo pra `never` (a negação de StatusImportacao dentro de um tipo
  // que já é só StatusImportacao).
  const emAndamento = status.concluidoEm === null;
  const travada = emAndamento && importacaoPareceTravada(status);
  const pct = status.total > 0 ? Math.round((status.feito / status.total) * 100) : 0;

  return (
    <div className={`execucao-status ${status.erro ? 'execucao-erro' : emAndamento ? 'execucao-rodando' : 'execucao-ok'}`}>
      <p>
        <strong>{ROTULO_TIPO[status.tipo]}</strong> — {status.arquivo}
      </p>
      <p>
        Started {formatarDataHora(status.iniciadoEm)}
        {emAndamento
          ? ` — ${status.feito}/${status.total} (${pct}%)${travada ? ', looks stuck' : '…'}`
          : `, finished ${formatarDataHora(status.concluidoEm as string)} — ${status.feito}/${status.total}`}
      </p>
      {status.erro && <p className="execucao-mensagem">{status.erro}</p>}
    </div>
  );
}
