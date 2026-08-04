import { normalizarTitulo } from './duplicatas';
import type { StatusPublicacao, Tipo } from '../types';

/**
 * Módulo puro de normalização do comix.to (Handout comix, Bloco C). Sem
 * Dexie, Supabase ou React — pensado pra ser copiado tal e qual pro
 * repositório da futura extensão de navegador (Bloco G3). O único import
 * externo permitido é `normalizarTitulo` (./duplicatas) e os tipos de
 * ../types.
 */

/** Payload normalizado de uma obra do comix.to, pronto para a tela de importação. */
export interface ComixObra {
  hid: string;
  titulo: string;
  titulosAlternativos: string[];
  tipo: Tipo | null;
  /** Valor bruto de `type` quando não reconhecido pelo mapa (null se reconhecido ou ausente) — E5 mostra esse valor entre parênteses na tela. */
  tipoBruto: string | null;
  statusPublicacao: StatusPublicacao | null;
  /** Valor bruto de `status` quando não reconhecido pelo mapa (mesma regra de tipoBruto). */
  statusPublicacaoBruto: string | null;
  /** Classificação bruta do site ("safe", etc.). Apenas exibida, nunca mapeada. */
  contentRating: string | null;
  capaUrl: string | null;
  ultimoCapitulo: number | null;
  /** URL absoluta da obra no comix.to. */
  url: string;
  autores: string[];
  artistas: string[];
  generos: string[];
  tags: string[];
  links: {
    anilist_url: string | null;
    myanimelist_url: string | null;
    mangaupdates_url: string | null;
    mangadex_url: string | null;
    mangabaka_url: string | null;
  };
}

export const BASE_COMIX = 'https://comix.to';

/** Mapa de tipo do comix para o enum do app. Valor desconhecido vira null (a dona escolhe na tela). */
const MAPA_TIPO: Record<string, Tipo> = {
  manga: 'Manga',
  manhwa: 'Manhwa',
  manhua: 'Manhua',
};

/** Mapa de status de publicação, conforme conciliação definida pela dona. */
const MAPA_STATUS: Record<string, StatusPublicacao> = {
  releasing: 'Ongoing',
  finished: 'Completed',
  on_hiatus: 'Hiatus',
  discontinued: 'Canceled',
};

interface AutorArtistaBruto {
  title?: string;
}

interface GeneroTagBruto {
  title?: string;
  slug?: string;
}

interface LinksBruto {
  al?: string | null;
  mal?: string | null;
  mu?: string | null;
  md?: string | null;
  mb?: string | null;
}

interface DetalheComixBruto {
  hid?: string;
  title?: string;
  altTitles?: unknown;
  type?: string;
  status?: string;
  poster?: { large?: string; medium?: string };
  latestChapter?: number;
  contentRating?: string;
  links?: LinksBruto;
  url?: string;
  authors?: AutorArtistaBruto[];
  artists?: AutorArtistaBruto[];
  genres?: GeneroTagBruto[];
  tags?: GeneroTagBruto[];
}

const INITIAL_DATA_RE = /<script[^>]+id=["']initial-data["'][^>]*>([\s\S]*?)<\/script>/i;

/**
 * Extrai o objeto de detalhe da obra a partir do HTML bruto de uma página de
 * título do comix.to. O site embute tudo num <script type="application/json"
 * id="initial-data">, e o detalhe fica em queries["manga","detail",<hid>].
 * Lança Error com mensagem legível quando o HTML não tem o formato esperado.
 */
export function extrairDetalheDoHtml(html: string): unknown {
  const match = INITIAL_DATA_RE.exec(html);
  if (!match) throw new Error('Unexpected comix.to page format: missing #initial-data script');

  let dados: unknown;
  try {
    dados = JSON.parse(match[1]);
  } catch {
    throw new Error('Unexpected comix.to page format: #initial-data is not valid JSON');
  }

  const obj = dados as { manga?: { hid?: string }; queries?: Record<string, unknown> };
  const hid = obj.manga?.hid;
  if (!hid || !obj.queries) {
    throw new Error('Unexpected comix.to page format: missing manga.hid or queries');
  }

  const detalhe = obj.queries[`["manga","detail","${hid}"]`];
  if (!detalhe) {
    throw new Error('Unexpected comix.to page format: missing detail query for this hid');
  }
  return detalhe;
}

function absolutizarUrl(caminho: string): string {
  if (/^https?:\/\//i.test(caminho)) return caminho;
  const comBarraInicial = caminho.startsWith('/') ? caminho : `/${caminho}`;
  return `${BASE_COMIX}${comBarraInicial}`;
}

function deduplicarAltTitles(altTitles: unknown, tituloPrincipal: string): string[] {
  if (!Array.isArray(altTitles)) return [];
  const vistos = new Set<string>([normalizarTitulo(tituloPrincipal)]);
  const resultado: string[] = [];
  for (const bruto of altTitles) {
    if (typeof bruto !== 'string') continue;
    const limpo = bruto.trim();
    if (!limpo) continue;
    const normalizado = normalizarTitulo(limpo);
    if (!normalizado || vistos.has(normalizado)) continue;
    vistos.add(normalizado);
    resultado.push(limpo);
  }
  return resultado;
}

function mapear<T extends string>(mapa: Record<string, T>, valor: string | undefined): T | null {
  if (!valor) return null;
  return mapa[valor.toLowerCase()] ?? null;
}

/** Extrai `.title` de cada objeto (authors/artists/genres/tags), preservando o
 * texto exatamente como o site entrega (nome nativo entre parênteses incluso). */
function extrairTitulos(itens: { title?: string }[] | undefined): string[] {
  return (itens ?? []).map((i) => (i.title ?? '').trim()).filter(Boolean);
}

/** Converte o objeto de detalhe cru do comix no payload normalizado do app. */
export function normalizarComix(detalhe: unknown): ComixObra {
  const d = (detalhe ?? {}) as DetalheComixBruto;
  if (!d.hid || !d.title || !d.url) {
    throw new Error('Unexpected comix.to page format');
  }

  const links = d.links ?? {};

  return {
    hid: d.hid,
    titulo: d.title,
    titulosAlternativos: deduplicarAltTitles(d.altTitles, d.title),
    tipo: mapear(MAPA_TIPO, d.type),
    tipoBruto: mapear(MAPA_TIPO, d.type) ? null : (d.type ?? null),
    statusPublicacao: mapear(MAPA_STATUS, d.status),
    statusPublicacaoBruto: mapear(MAPA_STATUS, d.status) ? null : (d.status ?? null),
    contentRating: d.contentRating ?? null,
    capaUrl: d.poster?.large || d.poster?.medium || null,
    // 0 e ausente viram null (0 é falsy, cobre os dois casos).
    ultimoCapitulo: d.latestChapter ? d.latestChapter : null,
    url: absolutizarUrl(d.url),
    autores: extrairTitulos(d.authors),
    artistas: extrairTitulos(d.artists),
    generos: extrairTitulos(d.genres),
    tags: extrairTitulos(d.tags),
    links: {
      anilist_url: links.al ?? null,
      myanimelist_url: links.mal ?? null,
      mangaupdates_url: links.mu ?? null,
      mangadex_url: links.md ?? null,
      mangabaka_url: links.mb ?? null,
    },
  };
}

// Mesma faixa Unicode do filtro de script não-romano usado no matching do
// Novel Updates (src/lib/novelupdates.ts, NAO_ROMANO: Hiragana/Katakana/Kana
// halfwidth, CJK e Hangul). Duplicada aqui de propósito — comix.ts não pode
// importar de novelupdates.ts (Bloco G3: precisa poder ser copiado tal e
// qual pro repositório da extensão). Se a faixa mudar num lugar, replicar no
// outro pra as duas não divergirem.
const SCRIPT_NAO_LATINO = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿ｦ-ﾟ]/;

/** true quando o título é predominantemente de escrita latina. Mesma faixa Unicode usada no matching do Novel Updates. */
export function ehTituloLatino(titulo: string): boolean {
  return !SCRIPT_NAO_LATINO.test(titulo);
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

/** Serializa o payload para o fragmento de URL (#d=...), em base64url sem padding, UTF-8 safe. */
export function codificarPayload(obra: ComixObra): string {
  return bytesParaBase64Url(new TextEncoder().encode(JSON.stringify(obra)));
}

/** Inverso de codificarPayload. Lança Error com mensagem legível se o payload for inválido. */
export function decodificarPayload(texto: string): ComixObra {
  try {
    const bytes = base64UrlParaBytes(texto);
    return JSON.parse(new TextDecoder().decode(bytes)) as ComixObra;
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid comix.to payload: ${detalhe}`);
  }
}

/** Aceita apenas https://comix.to/title/... e https://www.comix.to/title/... . Devolve a URL canônica ou null. */
export function validarUrlComix(entrada: string): string | null {
  let url: URL;
  try {
    url = new URL(entrada.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (host !== 'comix.to' && host !== 'www.comix.to') return null;
  if (!url.pathname.startsWith('/title/')) return null;
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
  return `https://${host}${path}`;
}
