/**
 * Lógica pura de link/nome de arquivo pra aba Images — sem Dexie, Supabase ou
 * React, testável isoladamente.
 */

/** Separa o texto colado por `;` ou por linha (Enter), descartando entradas vazias. */
export function dividirLinks(texto: string): string[] {
  return texto
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Só aceita https:// (mesma regra do proxy no servidor — ver supabase/functions/image-proxy). Devolve a URL canônica ou null. */
export function validarUrlImagem(entrada: string): string | null {
  let url: URL;
  try {
    url = new URL(entrada.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  return url.toString();
}

/** Deriva um nome a partir do último segmento do path da URL; cai pra "imagem-N" quando a URL não tem um segmento útil. */
export function nomeArquivoDaUrl(url: string, indice: number): string {
  try {
    const u = new URL(url);
    const ultimoSegmento = u.pathname.split('/').filter(Boolean).pop();
    if (ultimoSegmento) {
      const decodificado = decodeURIComponent(ultimoSegmento);
      if (decodificado.trim()) return decodificado;
    }
  } catch {
    // segue pro fallback
  }
  return `imagem-${indice + 1}`;
}

// eslint-disable-next-line no-control-regex
const CARACTERES_INVALIDOS_NOME = /[/\\:*?"<>|\x00-\x1f]/g;

/** Sanitiza um nome pra ser um nome de arquivo válido em qualquer destino (local/Supabase). */
export function normalizarNomeArquivo(nome: string): string {
  const limpo = nome.trim().replace(CARACTERES_INVALIDOS_NOME, '-').replace(/\s+/g, ' ').trim().slice(0, 150);
  return limpo || 'imagem';
}

const EXTENSAO_POR_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/tiff': 'tiff',
};

// "jpeg"/"tif" não aparecem como valor no mapa acima (os Content-Types de
// jpeg/tiff mapeiam pra "jpg"/"tiff"), mas são extensões de arquivo válidas
// que a usuária pode já ter usado no nome — reconhecer as duas evita anexar
// uma extensão duplicada (ex.: "capa.jpeg" virando "capa.jpeg.png").
const EXTENSOES_CONHECIDAS = new Set([...Object.values(EXTENSAO_POR_CONTENT_TYPE), 'jpeg', 'tif']);

/** Acrescenta a extensão certa (a partir do Content-Type real, baixado do proxy) quando o nome não já termina com uma extensão de imagem conhecida. */
export function garantirExtensao(nome: string, contentType: string): string {
  const extensaoAtual = nome.split('.').pop()?.toLowerCase();
  if (extensaoAtual && EXTENSOES_CONHECIDAS.has(extensaoAtual)) return nome;
  const extensao = EXTENSAO_POR_CONTENT_TYPE[contentType.toLowerCase().trim()];
  return extensao ? `${nome}.${extensao}` : nome;
}
