import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { buscarTudoPaginado } from '../lib/paginacao';

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
    void buscarTudoPaginado<{ nome: string }>((from, to) =>
      supabase.from('sites_suportados').select('nome').eq('ativo', true).order('nome').range(from, to)
    )
      .then((linhas) => {
        if (!cancelado) setAtivos(new Set(linhas.map((s) => String(s.nome).toLowerCase())));
      })
      .catch(() => {
        /* lista de apoio: falha aqui não deve derrubar a tela (mantém o Set vazio) */
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
    void buscarTudoPaginado<{ nome: string }>((from, to) =>
      supabase.from('sites_suportados').select('nome').eq('ativo', true).order('nome').range(from, to)
    )
      .then((linhas) => {
        if (!cancelado) setNomes(linhas.map((r) => r.nome as string));
      })
      .catch(() => {
        /* idem: sem lista, a tela só não separa "supported" de "web" */
      });
    return () => {
      cancelado = true;
    };
  }, []);

  return nomes;
}
