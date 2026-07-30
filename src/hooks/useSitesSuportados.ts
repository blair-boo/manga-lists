import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { ScraperRun, SiteSuportado } from '../types';

export interface SiteComRun {
  site: SiteSuportado;
  ultimaRunObras: ScraperRun | null;
  ultimaRunCapitulos: ScraperRun | null;
}

/** Status geral de um lote de runs por domínio (o "Latest run" acima da tabela). */
export type StatusAgregadoRun = 'sem_runs' | 'rodando' | 'erro' | 'concluido';

/**
 * Resume as últimas runs por domínio num status só: rodando se algum domínio
 * ainda roda, erro se algum falhou, senão concluído. 'nao_suportado' e
 * 'sem_adaptador' contam como conclusão normal — são comportamento esperado
 * do domínio (limitação estrutural), não falha do scraper.
 */
function agregarStatus(runs: (ScraperRun | null)[]): StatusAgregadoRun {
  const existentes = runs.filter((r): r is ScraperRun => r !== null);
  if (existentes.length === 0) return 'sem_runs';
  if (existentes.some((r) => r.status === 'rodando')) return 'rodando';
  if (existentes.some((r) => r.status === 'erro')) return 'erro';
  return 'concluido';
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

  const statusObras = useMemo(() => agregarStatus(sites.map((s) => s.ultimaRunObras)), [sites]);
  const statusCapitulos = useMemo(() => agregarStatus(sites.map((s) => s.ultimaRunCapitulos)), [sites]);

  const finalizadoObras = useMemo(() => maisRecenteFinalizacao(sites.map((s) => s.ultimaRunObras)), [sites]);
  const finalizadoCapitulos = useMemo(
    () => maisRecenteFinalizacao(sites.map((s) => s.ultimaRunCapitulos)),
    [sites]
  );

  return {
    sites,
    statusObras,
    statusCapitulos,
    finalizadoObras,
    finalizadoCapitulos,
    carregando,
    erro,
    recarregar,
  };
}

/** Maior `finalizado_em` (mais recente) entre as últimas runs de um tipo. */
function maisRecenteFinalizacao(runs: (ScraperRun | null)[]): string | null {
  let max: string | null = null;
  for (const r of runs) {
    if (r?.finalizado_em && (max === null || r.finalizado_em > max)) max = r.finalizado_em;
  }
  return max;
}
