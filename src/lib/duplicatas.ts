import type { Obra } from '../types';

/**
 * Detecção de obra duplicada por título. Módulo puro (sem Dexie/Supabase) pra
 * ser testável — o repo.ts só lê as obras e delega pra cá.
 */

export interface ObraDuplicada {
  obra: Obra;
  /** true = título idêntico (caso de bloqueio); false = só parecido (aviso). */
  exata: boolean;
}

/** Título comparável: sem acento, sem pontuação, minúsculo — "Re:Zero" e "re zero" batem. */
export function normalizarTitulo(titulo: string): string {
  return titulo
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Procura uma obra com o mesmo título na lista dada. Casamento exato
 * (case-insensitive) é duplicata de verdade; casamento normalizado, no título
 * ou num título alternativo, é só suspeita. `excluirId` tira a própria obra da
 * busca — sem ele, editar o título de uma obra existente acusaria duplicata
 * contra ela mesma.
 */
export function escolherDuplicata(obras: Obra[], titulo: string, excluirId?: string): ObraDuplicada | null {
  const alvo = titulo.trim();
  const alvoNormalizado = normalizarTitulo(alvo);
  if (!alvoNormalizado) return null;

  const alvoLower = alvo.toLowerCase();
  let aproximada: Obra | null = null;

  for (const o of obras) {
    if (o.id === excluirId) continue;
    // Exata ganha de qualquer aproximada já encontrada, então retorna na hora.
    if (o.titulo.trim().toLowerCase() === alvoLower) return { obra: o, exata: true };
    if (aproximada) continue;
    const bate =
      normalizarTitulo(o.titulo) === alvoNormalizado ||
      (o.titulos_alternativos ?? []).some((t) => normalizarTitulo(t) === alvoNormalizado);
    if (bate) aproximada = o;
  }

  return aproximada ? { obra: aproximada, exata: false } : null;
}
