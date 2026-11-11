// Módulo puro da importação do Novel Updates (bookmarklet próprio do NU, ver
// docs/EXTENSAO_NOVELUPDATES.md). Independente do comix.ts de propósito: o NU
// tem bookmarklet, payload e tela de importação separados. Sem Dexie, Supabase
// ou React aqui — só os tipos de ../types e o normalizador de ../duplicatas.

import { normalizarTitulo } from './duplicatas';
import type { Obra, StatusPublicacao } from '../types';

/** Tipos de obra que contam como "mangá e semelhantes" para o vínculo manga<->novel. */
const TIPOS_MANGA = new Set(['Manga', 'Manhwa', 'Manhua']);

/** Payload que o bookmarklet do Novel Updates monta a partir da página de série. */
export interface NovelImportada {
  /** Slug da série (da URL). Identidade do payload. */
  slug: string;
  titulo: string;
  titulosAlternativos: string[];
  statusPublicacao: StatusPublicacao | null;
  /** Texto bruto do "Status in COO" quando não reconhecido pelo mapa (exibido entre parênteses). */
  statusPublicacaoBruto: string | null;
  capaUrl: string | null;
  /** Capa pré-buscada como data URL pelo bookmarklet, ainda no contexto do NU. */
  capaBase64?: string | null;
  /** URL canônica da série no Novel Updates (vai para o campo novelupdates_url). */
  url: string;
  autores: string[];
  artistas: string[];
  generos: string[];
  tags: string[];
}

function bytesParaBase64Url(bytes: Uint8Array): string {
  let binario = '';
  bytes.forEach((b) => {
    binario += String.fromCharCode(b);
  });
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlParaBytes(texto: string): Uint8Array {
  const base64 = texto.replace(/-/g, '+').replace(/_/g, '/');
  const comPadding = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binario = atob(comPadding);
  return Uint8Array.from(binario, (c) => c.charCodeAt(0));
}

/** Serializa o payload para o fragmento de URL (#d=...), base64url sem padding, UTF-8 safe. */
export function codificarNovel(novel: NovelImportada): string {
  return bytesParaBase64Url(new TextEncoder().encode(JSON.stringify(novel)));
}

/** Inverso de codificarNovel. Lança Error com mensagem legível se o payload for inválido. */
export function decodificarNovel(texto: string): NovelImportada {
  try {
    const bytes = base64UrlParaBytes(texto);
    return JSON.parse(new TextDecoder().decode(bytes)) as NovelImportada;
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid Novel Updates payload: ${detalhe}`);
  }
}

/** URL do Novel Updates comparável: sem query, sem barra final, minúscula. */
export function urlNuComparavel(url: string | null | undefined): string {
  return (url ?? '').split('?')[0].replace(/\/+$/, '').toLowerCase();
}

/**
 * Seed da obra de destino: id da obra existente que casa com a novel, por link
 * do NU já gravado (prioridade) ou por título/títulos alternativos. '' quando
 * nenhuma casa (importação cria obra nova). A tela deixa a dona trocar depois.
 */
export function acharAlvoInicial(obras: Obra[], novel: NovelImportada): string {
  const alvoUrl = urlNuComparavel(novel.url);
  const porLink = obras.find((o) => o.novelupdates_url && urlNuComparavel(o.novelupdates_url) === alvoUrl);
  if (porLink) return porLink.id;

  const titulos = new Set([novel.titulo, ...novel.titulosAlternativos].map(normalizarTitulo).filter(Boolean));
  const porTitulo = obras.find((o) =>
    [o.titulo, ...(o.titulos_alternativos ?? [])].map(normalizarTitulo).some((t) => t && titulos.has(t))
  );
  return porTitulo ? porTitulo.id : '';
}

/** O que a confirmação vai fazer, derivado só da obra escolhida como alvo. */
export type PlanoImport =
  | { tipo: 'criarNova' }
  | { tipo: 'atualizar'; obra: Obra }
  | { tipo: 'criarVinculada'; manga: Obra };

/**
 * Decide a ação a partir do alvo escolhido (regra 2 da dona):
 *  - sem alvo            -> cria uma Novel nova e solta;
 *  - alvo é Novel        -> atualiza essa Novel e grava o link do NU;
 *  - alvo é mangá/afins   -> se já tem Novel vinculada, atualiza a vinculada;
 *                            senão, cria a Novel como obra correspondente ligada ao mangá.
 */
export function planoDoAlvo(obras: Obra[], alvoId: string): PlanoImport {
  if (!alvoId) return { tipo: 'criarNova' };
  const alvo = obras.find((o) => o.id === alvoId);
  if (!alvo) return { tipo: 'criarNova' };
  if (TIPOS_MANGA.has(alvo.tipo ?? '')) {
    const vinc = obras.find((o) => o.id === alvo.obra_vinculada_id && o.tipo === 'Novel');
    return vinc ? { tipo: 'atualizar', obra: vinc } : { tipo: 'criarVinculada', manga: alvo };
  }
  // Novel, ou tipo ainda não definido: grava direto na própria obra.
  return { tipo: 'atualizar', obra: alvo };
}
