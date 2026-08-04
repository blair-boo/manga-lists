// Edge Function: busca uma página de título do comix.to no servidor e devolve
// o objeto de detalhe cru (queries["manga","detail",<hid>] do initial-data).
//
// Motivo de existir: comix.to (o HTML) não manda cabeçalho CORS, então o
// navegador não consegue buscar a página direto — só um servidor pode. A
// normalização do objeto devolvido (mapas de tipo/status, links etc.) NÃO
// acontece aqui: vive em src/lib/comix.ts (normalizarComix), compartilhada
// com o caminho da extensão/bookmarklet, pra não existirem duas
// implementações do mesmo mapa.
//
// Fronteiras que esta função NÃO cruza (decisão explícita — ver README.md
// desta pasta): não escreve em scraper_runs; não lê nem escreve em
// sites_suportados/dominios_bloqueados; não dispara workflow nenhum do
// GitHub Actions; não usa GH_ACTIONS_TOKEN nem nenhum outro secret; não
// escreve em tabela nenhuma. É uma função de leitura pura: recebe URL,
// devolve JSON.
//
// Body esperado: { "url": "https://comix.to/title/<hid>-<slug>" }
// A autenticação já é garantida pelo Supabase (valida o JWT antes de
// invocar a função) — nenhuma checagem própria aqui.

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

// Cópia da regra de validarUrlComix (src/lib/comix.ts). Duplicada de
// propósito: esta função roda em Deno e não importa de src/ (ver README).
// Se a regra mudar num lugar, replicar no outro pra não divergirem.
function validarUrlComix(entrada: string): string | null {
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

const INITIAL_DATA_RE = /<script[^>]+id=["']initial-data["'][^>]*>([\s\S]*?)<\/script>/i;
const TIMEOUT_MS = 15000;

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

  const urlValida = validarUrlComix(url);
  if (!urlValida) {
    return jsonResponse({ error: 'URL inválida: aceita apenas https://comix.to/title/... ou https://www.comix.to/title/...' }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let html: string;
  try {
    const resp = await fetch(urlValida, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (resp.status !== 200) {
      return jsonResponse({ error: `comix.to respondeu ${resp.status} (possível bloqueio do Cloudflare)` }, 502);
    }
    html = await resp.text();
  } catch (err) {
    return jsonResponse({ error: `falha ao buscar comix.to: ${String(err)}` }, 502);
  } finally {
    clearTimeout(timeout);
  }

  const match = INITIAL_DATA_RE.exec(html);
  if (!match) {
    return jsonResponse(
      { error: 'HTML sem o script #initial-data (possível bloqueio do Cloudflare, não erro de digitação)' },
      502
    );
  }

  let dados: unknown;
  try {
    dados = JSON.parse(match[1]);
  } catch {
    return jsonResponse({ error: '#initial-data não é JSON válido' }, 502);
  }

  const obj = dados as { manga?: { hid?: string }; queries?: Record<string, unknown> };
  const hid = obj.manga?.hid;
  if (!hid || !obj.queries) {
    return jsonResponse({ error: 'initial-data sem manga.hid ou queries' }, 502);
  }

  const detalhe = obj.queries[`["manga","detail","${hid}"]`];
  if (!detalhe) {
    return jsonResponse({ error: 'queries sem o detalhe da obra para este hid' }, 502);
  }

  return jsonResponse({ detalhe });
});
