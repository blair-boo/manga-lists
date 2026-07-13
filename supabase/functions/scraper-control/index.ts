// Edge Function: inicia/para o workflow "Scraper - Fontes" no GitHub Actions.
//
// O token do GitHub (GH_ACTIONS_TOKEN) fica só aqui no servidor, nunca é
// exposto ao navegador. Exige usuária autenticada (Supabase já valida o JWT
// antes de invocar esta função).
//
// Body esperado: { "acao": "start" | "stop" }

const GITHUB_OWNER = 'blair-boo';
const GITHUB_REPO = 'manga-lists';
const WORKFLOW_FILE = 'scraper-fontes.yml';
const REF = 'main';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  let acao: string;
  try {
    ({ acao } = await req.json());
  } catch {
    return jsonResponse({ error: 'corpo da requisição inválido' }, 400);
  }

  if (acao !== 'start' && acao !== 'stop') {
    return jsonResponse({ error: 'ação inválida, use "start" ou "stop"' }, 400);
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
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
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
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=1`,
      { headers: ghHeaders }
    );
    if (!runsResp.ok) {
      return jsonResponse({ error: `GitHub respondeu ${runsResp.status}: ${await runsResp.text()}` }, 502);
    }
    const runsData = await runsResp.json();
    const ultimaRun = runsData.workflow_runs?.[0];
    if (!ultimaRun || !['in_progress', 'queued'].includes(ultimaRun.status)) {
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
