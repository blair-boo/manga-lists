import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../db/localDb';
import { setFonteAprovacao } from '../db/repo';
import {
  adicionarDominioBloqueado,
  dominioDeUrl,
  listarDominiosBloqueados,
  removerDominioBloqueado,
  type DominioBloqueado,
} from '../lib/scraperConfig';
import type { Fonte, Obra, StatusAprovacao } from '../types';

type Filtro = StatusAprovacao | 'blacklist';

const FILTROS_BASE: { valor: StatusAprovacao; rotulo: string }[] = [
  { valor: 'pendente', rotulo: 'Pending' },
  { valor: 'aprovado', rotulo: 'Approved' },
  { valor: 'rejeitado', rotulo: 'Rejected' },
];

/** Título aproximado da obra no site, derivado do slug da URL (para conferência). */
function tituloNoSite(url: string): string {
  try {
    const seg = new URL(url, 'https://x.invalid').pathname.split('/').filter(Boolean).pop() ?? '';
    return decodeURIComponent(seg).replace(/[-_]+/g, ' ').trim();
  } catch {
    return '';
  }
}

interface Props {
  titulo: string;
  /** Nomes dos sites suportados, para separar fontes de domínio suportado vs web. */
  sitesSuportados: string[];
  escopo: 'suportados' | 'novas';
  comBlacklist?: boolean;
}

/**
 * Fila de aprovações reutilizável (recolhida por padrão). Mostra fontes
 * descobertas automaticamente, filtradas por status, restritas ao escopo:
 *  - 'suportados': fontes em domínio de sites_suportados (vindas do update_obras)
 *  - 'novas': fontes fora dos sites suportados (fallback de busca web)
 * Com comBlacklist, adiciona o filtro extra que lista os domínios bloqueados.
 */
export function FilaAprovacoes({ titulo, sitesSuportados, escopo, comBlacklist }: Props) {
  const [aberta, setAberta] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>('pendente');
  const [blacklist, setBlacklist] = useState<DominioBloqueado[]>([]);

  const fontes = useLiveQuery(() => db.fontes.filter((f) => f.descoberta_automaticamente).toArray(), []);
  const obras = useLiveQuery(() => db.obras.toArray(), []);

  const suportadosSet = useMemo(() => new Set(sitesSuportados), [sitesSuportados]);

  const pertence = useCallback(
    (f: Fonte) => {
      const ehSuportado = !!f.site && suportadosSet.has(f.site);
      return escopo === 'suportados' ? ehSuportado : !ehSuportado;
    },
    [suportadosSet, escopo]
  );

  const recarregarBlacklist = useCallback(() => {
    listarDominiosBloqueados()
      .then(setBlacklist)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (comBlacklist && aberta) recarregarBlacklist();
  }, [comBlacklist, aberta, filtro, recarregarBlacklist]);

  const pendentesCount = useMemo(
    () => (fontes ?? []).filter((f) => f.status_aprovacao === 'pendente' && pertence(f)).length,
    [fontes, pertence]
  );

  const grupos = useMemo(() => {
    if (filtro === 'blacklist') return [];
    const obraPorId = new Map((obras ?? []).map((o) => [o.id, o]));
    const filtradas = (fontes ?? []).filter((f) => f.status_aprovacao === filtro && pertence(f));
    const porObra = new Map<string, Fonte[]>();
    for (const f of filtradas) {
      const lista = porObra.get(f.obra_id) ?? [];
      lista.push(f);
      porObra.set(f.obra_id, lista);
    }
    return Array.from(porObra.entries())
      .map(([obraId, lista]) => ({ obra: obraPorId.get(obraId), fontes: lista }))
      .filter((g): g is { obra: Obra; fontes: Fonte[] } => !!g.obra)
      .sort((a, b) => a.obra.titulo.localeCompare(b.obra.titulo));
  }, [fontes, obras, filtro, pertence]);

  async function handleBlacklist(url: string, fonteId: string) {
    const dominio = dominioDeUrl(url);
    if (!dominio) return;
    if (!confirm(`Blacklist ${dominio}? It won't be suggested again for any work.`)) return;
    await adicionarDominioBloqueado(dominio, 'Blacklisted from approvals queue');
    await setFonteAprovacao(fonteId, 'rejeitado');
    recarregarBlacklist();
  }

  async function handleUnblock(dominio: string) {
    await removerDominioBloqueado(dominio);
    recarregarBlacklist();
  }

  const filtros: { valor: Filtro; rotulo: string }[] = comBlacklist
    ? [...FILTROS_BASE, { valor: 'blacklist', rotulo: 'Blacklist' }]
    : FILTROS_BASE;

  return (
    <div className="fila-aprovacoes">
      <button
        type="button"
        className="fila-aprovacoes-toggle"
        onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta}
      >
        {aberta ? '▾' : '▸'} {titulo} ({pendentesCount} pending)
      </button>

      {aberta && (
        <div className="fila-aprovacoes-corpo">
          <div className="fila-filtros">
            {filtros.map((f) => (
              <button
                key={f.valor}
                type="button"
                className={`fila-filtro ${filtro === f.valor ? 'ativo' : ''}`}
                onClick={() => setFiltro(f.valor)}
              >
                {f.rotulo}
              </button>
            ))}
          </div>

          {filtro === 'blacklist' ? (
            blacklist.length === 0 ? (
              <p className="fontes-vazio">No blocked domains.</p>
            ) : (
              <ul className="fontes-lista">
                {blacklist.map((d) => (
                  <li key={d.id} className="fonte-item">
                    <span>{d.dominio}</span>
                    {d.motivo && <span className="scraper-data">{d.motivo}</span>}
                    <div className="fonte-acoes">
                      <button type="button" onClick={() => handleUnblock(d.dominio)}>
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : grupos.length === 0 ? (
            <p className="fontes-vazio">Nothing here.</p>
          ) : (
            grupos.map(({ obra, fontes: lista }) => (
              <div key={obra.id} className="fontes-pendentes-grupo">
                <Link to={`/obra/${obra.id}`} className="fontes-pendentes-titulo">
                  {obra.titulo}
                </Link>
                <ul>
                  {lista.map((f) => (
                    <li key={f.id} className="fonte-item fonte-aprovacao">
                      <div className="fonte-aprovacao-info">
                        <span className="fonte-site-titulo">
                          {f.site ?? dominioDeUrl(f.url)}: {tituloNoSite(f.url) || '—'}
                        </span>
                        <a href={f.url} target="_blank" rel="noreferrer" className="fonte-link">
                          {f.url}
                        </a>
                        {f.ultimo_capitulo_detectado != null && (
                          <span className="scraper-data">detected ch. {f.ultimo_capitulo_detectado}</span>
                        )}
                      </div>
                      <div className="fonte-acoes">
                        {f.status_aprovacao !== 'aprovado' && (
                          <button type="button" onClick={() => setFonteAprovacao(f.id, 'aprovado')}>
                            Approve
                          </button>
                        )}
                        {f.status_aprovacao !== 'rejeitado' && (
                          <button type="button" onClick={() => setFonteAprovacao(f.id, 'rejeitado')}>
                            Reject
                          </button>
                        )}
                        <button type="button" onClick={() => handleBlacklist(f.url, f.id)}>
                          Blacklist
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
