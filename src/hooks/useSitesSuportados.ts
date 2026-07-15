import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { ScraperRun, SiteSuportado } from '../types';

export interface SiteComRun {
  site: SiteSuportado;
  ultimaRunObras: ScraperRun | null;
}

/**
 * Carrega os sites suportados ativos e, para cada um, a execução mais recente do
 * scraper de obras (scraper_runs tipo='obras' com site_dominio = nome do site).
 * Busca direto do Supabase — essas tabelas não são offline-first.
 */
export function useSitesSuportados() {
  const [sites, setSites] = useState<SiteComRun[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    const [sitesResp, runsResp] = await Promise.all([
      supabase.from('sites_suportados').select('*').eq('ativo', true).order('nome'),
      supabase
        .from('scraper_runs')
        .select('*')
        .eq('tipo', 'obras')
        .order('iniciado_em', { ascending: false })
        .limit(100),
    ]);

    if (sitesResp.error || runsResp.error) {
      setErro(sitesResp.error?.message ?? runsResp.error?.message ?? 'erro');
      setCarregando(false);
      return;
    }

    // Última run de obras por site_dominio (a query já vem ordenada desc).
    const ultimaPorSite = new Map<string, ScraperRun>();
    for (const run of (runsResp.data ?? []) as ScraperRun[]) {
      if (run.site_dominio && !ultimaPorSite.has(run.site_dominio)) {
        ultimaPorSite.set(run.site_dominio, run);
      }
    }

    setSites(
      ((sitesResp.data ?? []) as SiteSuportado[]).map((site) => ({
        site,
        ultimaRunObras: ultimaPorSite.get(site.nome) ?? null,
      }))
    );
    setCarregando(false);
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  return { sites, carregando, erro, recarregar };
}
