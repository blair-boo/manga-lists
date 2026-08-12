// Edge Function: busca uma imagem arbitrária (https) no servidor e devolve
// os bytes crus com CORS liberado.
//
// Motivo de existir: a aba Images (Settings) baixa imagens de domínios de
// terceiros escolhidos pela usuária; a maioria não manda
// Access-Control-Allow-Origin, então o navegador não consegue buscar direto
// (mesmo motivo de existir de comix-fetch, ver README daquela pasta). Função
// genérica de propósito: não sabe nada sobre Supabase Storage, dispositivo
// local ou qualquer destino — só busca a URL e devolve bytes. Todo o
// roteamento por destino vive no cliente (src/lib/imagensBatch.ts e afins).
//
// Content-Type da resposta de sucesso é sempre "application/octet-stream"
// (nunca o tipo real da imagem) DE PROPÓSITO: o cliente supabase-js só faz
// parse automático da resposta como Blob para "application/octet-stream"/
// "application/pdf" — qualquer outro Content-Type (ex. "image/png") cai no
// fallback de texto do cliente e corrompe os bytes binários. O tipo real da
// imagem vai no header X-Image-Content-Type; ver src/lib/imageProxy.ts.
//
// Body esperado: { "url": "https://..." }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

const TIMEOUT_MS = 15000;
const MAX_BYTES = 25 * 1024 * 1024; // 25MB

// Mitigação best-effort contra SSRF: bloqueia hosts óbvios de rede
// privada/loopback. Não protege contra DNS rebinding (validar o hostname não
// impede que ele resolva pra um IP privado depois) — aceitável aqui porque o
// alvo é sempre uma imagem pública escolhida pela própria usuária, não input
// de terceiros não confiáveis.
function hostBloqueado(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0') return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (h === '::1' || h.startsWith('[::1]')) return true;
  return false;
}

function validarUrlAlvo(entrada: string): string | null {
  let url: URL;
  try {
    url = new URL(entrada.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (hostBloqueado(url.hostname)) return null;
  return url.toString();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  let url: string | undefined;
  try {
    ({ url } = await req.json());
  } catch {
    return jsonResponse({ error: 'corpo da requisição inválido' }, 400);
  }

  if (!url) {
    return jsonResponse({ error: 'campo "url" ausente' }, 400);
  }

  const urlValida = validarUrlAlvo(url);
  if (!urlValida) {
    return jsonResponse({ error: 'URL inválida: aceita apenas https:// e hosts públicos' }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(urlValida, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'image/*',
      },
    });
  } catch (err) {
    clearTimeout(timeout);
    return jsonResponse({ error: `falha ao buscar a imagem: ${String(err)}` }, 502);
  }

  if (!resp.ok) {
    clearTimeout(timeout);
    return jsonResponse({ error: `servidor de origem respondeu ${resp.status}` }, 502);
  }

  const contentType = resp.headers.get('Content-Type')?.split(';')[0].trim() ?? '';
  if (!contentType.startsWith('image/')) {
    clearTimeout(timeout);
    return jsonResponse({ error: `resposta não é uma imagem (Content-Type: ${contentType || 'ausente'})` }, 415);
  }

  if (!resp.body) {
    clearTimeout(timeout);
    return jsonResponse({ error: 'resposta sem corpo' }, 502);
  }

  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        controller.abort();
        return jsonResponse({ error: `imagem maior que o limite de ${MAX_BYTES / 1024 / 1024}MB` }, 413);
      }
      chunks.push(value);
    }
  } catch (err) {
    return jsonResponse({ error: `falha ao ler a imagem: ${String(err)}` }, 502);
  } finally {
    clearTimeout(timeout);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/octet-stream',
      'X-Image-Content-Type': contentType,
    },
  });
});
