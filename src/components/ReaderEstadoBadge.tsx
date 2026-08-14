import { formatarDataHora, rotuloEstadoReader } from '../lib/reader';
import type { ReaderEstadoObra, ReaderObra } from '../types';

interface Props {
  estado: ReaderEstadoObra;
  estadoEm: string | null;
  reader: ReaderObra;
}

/**
 * Estado do pipeline + quando ele mudou + como foi a última busca. Os três
 * dados que a lista pede ficam juntos porque respondem à mesma pergunta:
 * "isto está andando, e a última tentativa deu certo?".
 */
export function ReaderEstadoBadge({ estado, estadoEm, reader }: Props) {
  const buscaOk = reader.ultima_busca_ok;
  return (
    <div className="reader-estado">
      <span className={`badge reader-estado-badge reader-estado-${estado}`}>{rotuloEstadoReader(estado)}</span>
      <span className="reader-estado-quando">{formatarDataHora(estadoEm)}</span>
      <span className="reader-busca">
        Last search: {formatarDataHora(reader.ultima_busca_em)}
        {buscaOk !== null && (
          <span
            className={buscaOk ? 'reader-busca-ok' : 'reader-busca-erro'}
            title={reader.ultima_busca_mensagem ?? undefined}
          >
            {buscaOk ? 'success' : 'error'}
          </span>
        )}
      </span>
    </div>
  );
}
