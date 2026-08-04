# comix-fetch

Edge Function de leitura pura: recebe a URL de uma página de título do
comix.to, busca o HTML no servidor e devolve o objeto de detalhe cru
embutido em `<script type="application/json" id="initial-data">`
(`queries["manga","detail",<hid>]`).

Existe porque `comix.to` (o HTML) não manda cabeçalho CORS — o navegador não
consegue buscar a página direto. `static.comix.to` (as capas) já responde com
`access-control-allow-origin: *`, então o download da capa não precisa
passar por aqui.

Não normaliza nada: os mapas de tipo/status/links vivem em `src/lib/comix.ts`
(`normalizarComix`), compartilhado com o caminho da extensão/bookmarklet.

## Contrato

- Body: `{ "url": "https://comix.to/title/x0ynk-..." }`
- 200: `{ "detalhe": { ...objeto cru de queries["manga","detail",hid]... } }`
- 400: URL ausente ou de host não permitido (só `comix.to`/`www.comix.to`,
  path `/title/...`).
- 502: comix.to respondeu com status diferente de 200, ou o HTML não tinha o
  `initial-data` (provável bloqueio do Cloudflare).

A autenticação já é garantida pelo Supabase, que valida o JWT antes de
invocar a função — nenhuma checagem própria aqui.

## Deploy

```
supabase functions deploy comix-fetch
```

Não precisa de nenhum secret.

## Fronteiras (decisão explícita — não cruzar)

Esta função tem que ficar isolada do scraper (`scraper/`, Python + GitHub
Actions) e da `scraper-control` (que dispara workflows). Ela:

- não escreve em `scraper_runs`;
- não lê nem escreve em `sites_suportados` nem em `dominios_bloqueados`;
- não dispara workflow nenhum do GitHub Actions;
- não usa `GH_ACTIONS_TOKEN` nem qualquer outro secret (não precisa de nenhum);
- não escreve em tabela nenhuma — recebe URL, devolve JSON.

Se algo aqui parecer duplicação com `scraper-control` (ex.: `CORS_HEADERS`),
manter duplicado mesmo assim: são funções com ciclos de vida e superfícies de
risco diferentes, e um `supabase/functions/_shared/` acoplaria as duas sem
ganho real neste tamanho.
