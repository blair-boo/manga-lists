import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { controlarScraper } from '../lib/scraperControl';
import { useScraperRun } from '../hooks/useScraperRun';
import { StatusExecucaoScraper } from './StatusExecucaoScraper';
import type { DiagnosticoAdaptador, SiteSuportado } from '../types';

/** Rótulo amigável para cada parse_status do diagnóstico. */
const STATUS_ROTULO: Record<string, string> = {
  ok: 'recognized and parsed',
  estrutura_vazia: 'recognized, valid but empty (possibly ok)',
  estrutura_invalida: 'recognized, but format diverged — closest match',
  acesso_bloqueado: 'access blocked (e.g. Cloudflare) — access issue, not parsing',
  erro: 'unexpected failure',
  '-': 'not applicable',
};

function EntradasDiagnostico({ diagnostico }: { diagnostico: DiagnosticoAdaptador | null }) {
  if (!diagnostico || diagnostico.entradas.length === 0) {
    return <p className="diag-vazio">No diagnostic yet — run detection.</p>;
  }
  return (
    <ul className="diag-lista">
      {diagnostico.entradas.map((e) => (
        <li key={e.adapter_id} className={`diag-entrada diag-${e.parse_status}`}>
          <strong>{e.adapter_id}</strong>: {e.mensagem || STATUS_ROTULO[e.parse_status] || e.parse_status}
        </li>
      ))}
    </ul>
  );
}

/**
 * Fila "domínio sem adaptador" (ver HANDOUT_ARQUITETURA_SCRAPERS, Modo
 * Diagnóstico). Lista os domínios já APROVADOS (ativo=true) de
 * sites_suportados que ainda não têm adaptador designado e mostra o
 * relatório de diagnóstico anexado, dando um ponto de partida para
 * escrever/designar um adaptador manualmente. O botão dispara a
 * auto-detecção. Domínios pendentes de aprovação (ativo=false) ficam na fila
 * separada "Domain approvals" — este componente não decide aprovação.
 */
export function DominiosSemAdaptador() {
  const [sites, setSites] = useState<SiteSuportado[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [acionando, setAcionando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const designar = useScraperRun('designar');

  const recarregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    const { data, error } = await supabase
      .from('sites_suportados')
      .select('*')
      .eq('ativo', true)
      .is('adaptador', null)
      .order('nome');
    if (error) setErro(error.message);
    else setSites((data ?? []) as SiteSuportado[]);
    setCarregando(false);
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  async function detectar() {
    setAcionando(true);
    setErroAcao(null);
    try {
      await controlarScraper('designar', 'start');
      await designar.recarregar();
    } catch (err) {
      setErroAcao(err instanceof Error ? err.message : String(err));
    } finally {
      setAcionando(false);
    }
  }

  return (
    <div className="dominios-sem-adaptador">
      <div className="scraper-controles">
        <button type="button" onClick={detectar} disabled={acionando}>
          {acionando ? 'Please wait…' : 'Detect adapters'}
        </button>
        <button type="button" className="botao-secundario" onClick={() => void recarregar()} disabled={carregando}>
          Refresh
        </button>
      </div>
      {erroAcao && <p className="execucao-status execucao-erro">{erroAcao}</p>}

      <StatusExecucaoScraper run={designar.run} carregando={designar.carregando} erro={designar.erro} />

      {carregando ? (
        <p className="execucao-status">Loading…</p>
      ) : erro ? (
        <p className="execucao-status execucao-erro">Error loading: {erro}</p>
      ) : sites.length === 0 ? (
        <p className="execucao-status">Every registered domain has an adapter. Nothing to review.</p>
      ) : (
        <ul className="dominios-lista">
          {sites.map((site) => (
            <li key={site.id} className="dominio-item">
              <div className="dominio-cabecalho">
                <span className="dominio-nome">{site.nome}</span>
                {site.url_base && (
                  <a href={site.url_base} target="_blank" rel="noreferrer" className="dominio-link">
                    open
                  </a>
                )}
              </div>
              <EntradasDiagnostico diagnostico={site.diagnostico} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
