// Edge Function: inicia/para os workflows do scraper no GitHub Actions.
//
// O token do GitHub (GH_ACTIONS_TOKEN) fica só aqui no servidor, nunca é
// exposto ao navegador. Exige usuária autenticada (Supabase já valida o JWT
// antes de invocar esta função).
//
// Body esperado: { "acao": "start" | "stop", "alvo": "capitulos" | "obras" | "fontes" }

const GITHUB_OWNER = 'blair-boo';
const GITHUB_REPO = 'manga-lists';
const REF = 'main';

const WORKFLOW_FILES: Record<string, string> = {
  capitulos: 'scraper-capitulos.yml',
  obras: 'scraper-obras.yml',
  fontes: 'scraper-fontes.yml',
};

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  let acao: string;
  let alvo: string;
  try {
    ({ acao, alvo } = await req.json());
  } catch {
    return jsonResponse({ error: 'corpo da requisição inválido' }, 400);
  }

  if (acao !== 'start' && acao !== 'stop') {
    return jsonResponse({ error: 'ação inválida, use "start" ou "stop"' }, 400);
  }

  const workflowFile = WORKFLOW_FILES[alvo];
  if (!workflowFile) {
    return jsonResponse({ error: 'alvo inválido, use "capitulos", "obras" ou "fontes"' }, 400);
  }

  const token = Deno.env.get('GH_ACTIONS_TOKEN');
  if (!token) {
    return jsonResponse({ error: 'GH_ACTIONS_TOKEN não configurado nos secrets da Edge Function' }, 500);
  }

  const ghHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  try {
    if (acao === 'start') {
      const resp = await fetch(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${workflowFile}/dispatches`,
        {
          method: 'POST',
          headers: { ...ghHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref: REF }),
        }
      );
      if (!resp.ok) {
        return jsonResponse({ error: `GitHub respondeu ${resp.status}: ${await resp.text()}` }, 502);
      }
      return jsonResponse({ ok: true });
    }

    // acao === 'stop': cancela a execução em andamento, se houver
    const runsResp = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${workflowFile}/runs?per_page=1`,
      { headers: ghHeaders }
    );
    if (!runsResp.ok) {
      return jsonResponse({ error: `GitHub respondeu ${runsResp.status}: ${await runsResp.text()}` }, 502);
    }
    const runsData = await runsResp.json();
    const ultimaRun = runsData.workflow_runs?.[0];
    // Cancela qualquer run que ainda não terminou (queued, pending, in_progress,
    // waiting, requested…). Antes só pegava in_progress/queued e deixava runs
    // presas em 'pending' sem como parar.
    if (!ultimaRun || ultimaRun.status === 'completed') {
      return jsonResponse({ ok: true, mensagem: 'Nenhuma execução em andamento pra cancelar' });
    }

    const cancelResp = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${ultimaRun.id}/cancel`,
      { method: 'POST', headers: ghHeaders }
    );
    if (!cancelResp.ok) {
      return jsonResponse({ error: `GitHub respondeu ${cancelResp.status}: ${await cancelResp.text()}` }, 502);
    }
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
