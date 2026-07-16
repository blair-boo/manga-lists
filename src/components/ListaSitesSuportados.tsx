import { useState } from 'react';
import { useSitesSuportados, type SiteComRun } from '../hooks/useSitesSuportados';
import type { ScraperRun } from '../types';

function formatarDataHora(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
}

const STATUS_LABEL: Record<ScraperRun['status'], string> = {
  rodando: 'In progress',
  concluido: 'Done',
  erro: 'Error',
};

const STATUS_CLASSE: Record<ScraperRun['status'], string> = {
  rodando: 'site-status-rodando',
  concluido: 'site-status-ok',
  erro: 'site-status-erro',
};

export function ListaSitesSuportados() {
  const { sites, carregando, erro } = useSitesSuportados();
  const [expandido, setExpandido] = useState<string | null>(null);
  const [aberta, setAberta] = useState(false);

  return (
    <div className="dominios-sem-adaptador">
      <button
        type="button"
        className="fila-aprovacoes-toggle"
        onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta}
      >
        {aberta ? '▾' : '▸'} Approved domains ({carregando ? '…' : sites.length})
      </button>

      {aberta && <ListaSitesSuportadosCorpo sites={sites} carregando={carregando} erro={erro} expandido={expandido} setExpandido={setExpandido} />}
    </div>
  );
}

function ListaSitesSuportadosCorpo({
  sites,
  carregando,
  erro,
  expandido,
  setExpandido,
}: {
  sites: SiteComRun[];
  carregando: boolean;
  erro: string | null;
  expandido: string | null;
  setExpandido: (v: string | null) => void;
}) {
  if (carregando) return <p className="execucao-status">Loading sites…</p>;
  if (erro) return <p className="execucao-status execucao-erro">Error loading sites: {erro}</p>;
  if (sites.length === 0) return <p className="execucao-status">No supported sites.</p>;

  return (
    <div className="sites-suportados">
      <div className="sites-suportados-cabecalho">
        <span>Site</span>
        <span>Works — latest run</span>
      </div>

      {sites.map(({ site, ultimaRunObras }) => {
        const aberto = expandido === site.id;
        return (
          <div key={site.id} className="site-linha">
            <button
              type="button"
              className="site-linha-topo"
              onClick={() => setExpandido(aberto ? null : site.id)}
              aria-expanded={aberto}
            >
              <span className="site-nome">{site.nome}</span>
              {ultimaRunObras ? (
                <span className={`site-status ${STATUS_CLASSE[ultimaRunObras.status]}`}>
                  {STATUS_LABEL[ultimaRunObras.status]}
                </span>
              ) : (
                <span className="site-status site-status-nunca">no run yet</span>
              )}
            </button>

            {aberto && (
              <div className="site-detalhe">
                {ultimaRunObras ? (
                  <>
                    <p>Started: {formatarDataHora(ultimaRunObras.iniciado_em)}</p>
                    <p>Finished: {formatarDataHora(ultimaRunObras.finalizado_em)}</p>
                    {ultimaRunObras.mensagem && <p>{ultimaRunObras.mensagem}</p>}
                  </>
                ) : (
                  <p>This site's catalog hasn't been scanned yet.</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
