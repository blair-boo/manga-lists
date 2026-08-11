import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { ScraperRun, ScraperTipo } from '../types';

/**
 * Acima disso, uma run com status 'rodando' é tratada como travada em vez de
 * "em andamento". Sem isso, uma run que quebrou no meio (o script morreu sem
 * gravar 'concluido'/'erro') fica "rodando" pra sempre no banco, e a tela
 * mostra "Stop search" indefinidamente mesmo sem nada rodando de verdade —
 * aconteceu de verdade com 'fontes' e 'novelupdates' (runs de semanas atrás
 * ainda marcadas 'rodando'). Generoso acima da maior run observada (~2h).
 */
const LIMITE_RODANDO_MS = 3 * 60 * 60 * 1000;

function runPareceTravada(run: ScraperRun): boolean {
  return run.status === 'rodando' && Date.now() - new Date(run.iniciado_em).getTime() > LIMITE_RODANDO_MS;
}

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

  const travada = run !== null && runPareceTravada(run);
  const rodando = run !== null && run.status === 'rodando' && !travada;

  return { run, rodando, travada, carregando, erro, recarregar };
}
