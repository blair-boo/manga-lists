import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

/**
 * Nomes dos domínios aprovados para scraping (sites_suportados.ativo=true).
 * Usado para marcar fontes de domínio não aprovado como "unmonitored"
 * (handout consolidado, Bloco C4). Busca direto do Supabase — essa tabela
 * não é offline-first.
 */
export function useSitesAtivos(): Set<string> {
  const [ativos, setAtivos] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelado = false;
    supabase
      .from('sites_suportados')
      .select('nome')
      .eq('ativo', true)
      .then(({ data }) => {
        if (!cancelado) setAtivos(new Set((data ?? []).map((s) => String(s.nome).toLowerCase())));
      });
    return () => {
      cancelado = true;
    };
  }, []);

  return ativos;
}

/**
 * Nomes (com o case original) dos sites_suportados ativos — usado por
 * FilaAprovacoes pra separar fontes "supported" vs "web", que compara
 * `fonte.site` sem normalizar case (useSitesAtivos não serve aqui porque
 * devolve os nomes em lowercase).
 */
export function useNomesSitesAtivos(): string[] {
  const [nomes, setNomes] = useState<string[]>([]);

  useEffect(() => {
    let cancelado = false;
    supabase
      .from('sites_suportados')
      .select('nome')
      .eq('ativo', true)
      .then(({ data }) => {
        if (!cancelado) setNomes((data ?? []).map((r) => r.nome as string));
      });
    return () => {
      cancelado = true;
    };
  }, []);

  return nomes;
}
