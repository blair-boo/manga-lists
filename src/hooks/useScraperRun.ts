import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { ScraperRun, ScraperTipo } from '../types';

export function useScraperRun(tipo: ScraperTipo) {
  const [run, setRun] = useState<ScraperRun | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    const { data, error } = await supabase
      .from('scraper_runs')
      .select('*')
      .eq('tipo', tipo)
      .order('iniciado_em', { ascending: false })
      .limit(1);
    if (error) {
      setErro(error.message);
    } else {
      setRun((data?.[0] as ScraperRun) ?? null);
    }
    setCarregando(false);
  }, [tipo]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  return { run, carregando, erro, recarregar };
}
