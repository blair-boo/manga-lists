import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { ScraperRun, SiteSuportado } from '../types';

export interface SiteComRun {
  site: SiteSuportado;
  ultimaRunObras: ScraperRun | null;
  ultimaRunCapitulos: ScraperRun | null;
}

/**
 * Carrega os sites suportados ativos e, para cada um, a execução mais recente
 * dos scrapers de obras e de capítulos (scraper_runs com site_dominio = nome
 * do site). Busca direto do Supabase — essas tabelas não são offline-first.
 */
export function useSitesSuportados() {
  const [sites, setSites] = useState<SiteComRun[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    const [sitesResp, obrasResp, capitulosResp] = await Promise.all([
      supabase.from('sites_suportados').select('*').eq('ativo', true).order('nome'),
      supabase.from('scraper_runs').select('*').eq('tipo', 'obras').order('iniciado_em', { ascending: false }).limit(100),
      supabase.from('scraper_runs').select('*').eq('tipo', 'capitulos').order('iniciado_em', { ascending: false }).limit(200),
    ]);

    if (sitesResp.error || obrasResp.error || capitulosResp.error) {
      setErro(sitesResp.error?.message ?? obrasResp.error?.message ?? capitulosResp.error?.message ?? 'erro');
      setCarregando(false);
      return;
    }

    // Última run por site_dominio (as queries já vêm ordenadas desc).
    function ultimaPorDominio(runs: ScraperRun[]) {
      const mapa = new Map<string, ScraperRun>();
      for (const run of runs) {
        if (run.site_dominio && !mapa.has(run.site_dominio)) mapa.set(run.site_dominio, run);
      }
      return mapa;
    }

    const porObras = ultimaPorDominio((obrasResp.data ?? []) as ScraperRun[]);
    const porCapitulos = ultimaPorDominio((capitulosResp.data ?? []) as ScraperRun[]);

    setSites(
      ((sitesResp.data ?? []) as SiteSuportado[]).map((site) => ({
        site,
        ultimaRunObras: porObras.get(site.nome) ?? null,
        ultimaRunCapitulos: porCapitulos.get(site.nome) ?? null,
      }))
    );
    setCarregando(false);
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  return { sites, carregando, erro, recarregar };
}
