import { useState } from 'react';
import type { SiteComRun } from '../hooks/useSitesSuportados';
import type { ScraperRun } from '../types';

const STATUS_LABEL: Record<ScraperRun['status'], string> = {
  rodando: 'In progress',
  concluido: 'Done',
  erro: 'Error',
  nao_suportado: 'Not supported',
  sem_adaptador: 'No adapter',
};

const STATUS_CLASSE: Record<ScraperRun['status'], string> = {
  rodando: 'site-status-rodando',
  concluido: 'site-status-ok',
  erro: 'site-status-erro',
  nao_suportado: 'site-status-nao-suportado',
  sem_adaptador: 'site-status-sem-adaptador',
};

/** Só o status de conclusão de uma run, compacto (colunas Works/Chapters e "Latest run"). */
export function StatusResumidoScraper({
  run,
  carregando,
  erro,
}: {
  run: ScraperRun | null;
  carregando?: boolean;
  erro?: string | null;
}) {
  if (carregando) return <span className="site-status">Loading…</span>;
  if (erro) return <span className="site-status site-status-erro">Error: {erro}</span>;
  if (!run) return <span className="site-status site-status-nunca">no run yet</span>;
  return <span className={`site-status ${STATUS_CLASSE[run.status]}`}>{STATUS_LABEL[run.status]}</span>;
}

function formatarDataHora(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
}

interface Props {
  sites: SiteComRun[];
  carregando: boolean;
  erro: string | null;
}

export function ListaSitesSuportados({ sites, carregando, erro }: Props) {
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

      {aberta && (
        <ListaSitesSuportadosCorpo sites={sites} carregando={carregando} erro={erro} expandido={expandido} setExpandido={setExpandido} />
      )}
    </div>
  );
}

function ListaSitesSuportadosCorpo({
  sites,
  carregando,
  erro,
  expandido,
  setExpandido,
}: Props & { expandido: string | null; setExpandido: (v: string | null) => void }) {
  if (carregando) return <p className="execucao-status">Loading sites…</p>;
  if (erro) return <p className="execucao-status execucao-erro">Error loading sites: {erro}</p>;
  if (sites.length === 0) return <p className="execucao-status">No supported sites.</p>;

  return (
    <div className="sites-suportados">
      <div className="sites-suportados-cabecalho">
        <span className="site-nome-col">Site</span>
        <span className="site-status-col">Works</span>
        <span className="site-status-col">Chapters</span>
      </div>

      {sites.map(({ site, ultimaRunObras, ultimaRunCapitulos }) => {
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
              <span className="site-status-col">
                <StatusResumidoScraper run={ultimaRunObras} />
              </span>
              <span className="site-status-col">
                <StatusResumidoScraper run={ultimaRunCapitulos} />
              </span>
            </button>

            {aberto && (
              <div className="site-detalhe">
                {ultimaRunObras ? (
                  <>
                    <p>Works, started: {formatarDataHora(ultimaRunObras.iniciado_em)}</p>
                    <p>Works, finished: {formatarDataHora(ultimaRunObras.finalizado_em)}</p>
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
