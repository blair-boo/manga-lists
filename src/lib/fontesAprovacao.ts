import type { Fonte } from '../types';

/**
 * Uma fonte pertence ao escopo 'suportados' quando seu domínio está entre os
 * sites_suportados ativos passados em `sitesSuportadosSet`; 'novas' é o
 * complemento (resultados de busca web, fora dos sites conhecidos).
 * Compartilhado entre FilaAprovacoes e a contagem usada na barra de
 * pendências (Updates), pra não haver duas versões do mesmo critério.
 */
export function fontePertenceAoEscopo(
  fonte: Fonte,
  escopo: 'suportados' | 'novas',
  sitesSuportadosSet: Set<string>
): boolean {
  const ehSuportado = !!fonte.site && sitesSuportadosSet.has(fonte.site);
  return escopo === 'suportados' ? ehSuportado : !ehSuportado;
}
