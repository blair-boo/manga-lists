import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listarDominiosPendentes } from '../lib/scraperConfig';
import { useFontesPendentesCount } from '../hooks/useFontesPendentes';
import { useFontesTipoDivergenteObrasCount } from '../hooks/useFontesTipoDivergente';

interface Props {
  /** Nomes dos sites suportados ativos — mesmo dado usado por FilaAprovacoes pra separar escopos. */
  sitesSuportados: string[];
}

/**
 * Resumo de pendências no topo de Updates: quantas fontes/domínios esperam
 * aprovação, sem precisar abrir Settings > Sources (onde essas filas vivem
 * de fato) só pra conferir. New Sources/Works são reativos (Dexie); Domains
 * Scrapers vem de um fetch direto ao Supabase (mesma fonte de dado que
 * AprovacaoDominios usa, que também não é reativa).
 */
export function PendingApprovalsBar({ sitesSuportados }: Props) {
  const novasCount = useFontesPendentesCount('novas', sitesSuportados);
  const worksCount = useFontesPendentesCount('suportados', sitesSuportados);
  const tipoDivergenteCount = useFontesTipoDivergenteObrasCount();
  const [domainsCount, setDomainsCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelado = false;
    listarDominiosPendentes()
      .then((lista) => {
        if (!cancelado) setDomainsCount(lista.length);
      })
      .catch(() => {
        if (!cancelado) setDomainsCount(null);
      });
    return () => {
      cancelado = true;
    };
  }, []);

  return (
    <div className="pending-approvals-bar">
      <span className="pending-approvals-rotulo">Pending Approvals:</span>
      <Link to="/settings/sources" className="pending-approvals-item">
        New Sources <span className="status-chip-contagem">{novasCount}</span>
      </Link>
      <Link to="/settings/sources" className="pending-approvals-item">
        Domains Scrapers <span className="status-chip-contagem">{domainsCount ?? '…'}</span>
      </Link>
      <Link to="/settings/sources" className="pending-approvals-item">
        Works <span className="status-chip-contagem">{worksCount}</span>
      </Link>
      <Link to="/settings/sources" className="pending-approvals-item">
        Sources Type <span className="status-chip-contagem">{tipoDivergenteCount}</span>
      </Link>
    </div>
  );
}
