# Scraping API para comix.to (ScraperAPI / scrape.do)

## O problema

comix.to (e o espelho comix.ws) fica atrás de um **challenge JS do Cloudflare**
("Just a moment…") que o cliente HTTP direto do scraper não resolve —
`requests`, `cloudscraper` e o fallback via `curl` levam todos 403. Confirmado
tanto nesta sandbox quanto no runner do GitHub Actions (ver o commit de
diagnóstico). Resultado: nenhuma obra casava no catálogo e nenhum capítulo era
atualizado, apesar do `ComixAdapter` estar correto — o conteúdo nunca chegava
até ele.

## A solução

Rotear **só os hosts do comix** por uma API de scraping que executa o JS e
devolve o HTML/JSON já liberado. O código está em `scraper/scraping_api.py` e
é acionado dentro de `common.http_get`, então cobre os três estágios de uma
vez (capítulos, catálogo e descoberta), já que todos passam por ali.

Suporta três providers, na ordem em que se quiser: **ScraperAPI**,
**ScrapingBee** e **scrape.do**. Todos têm plano grátis (trial/mensal). A ordem
(`SCRAPING_API_ORDER`, default `scraperapi,scrapingbee,scrapedo`) permite
"gastar o crédito que expira primeiro e cair no próximo quando esgotar" sem
trocar código — quando um provider devolve erro (cota/500), o próximo é tentado
automaticamente. Só entram na cascata os providers que têm chave configurada.

**Resultado da 1ª run real (30/07, capítulos):** o ScraperAPI (só `render_js`
básico, sem `ultra`) venceu o Cloudflare do comix em **15 de 18** páginas; as
outras 3 deram HTTP 500 transiente e caíram pro próximo provider, que entregou.
Ou seja: `render` básico já resolve o comix, não precisa do tier residencial
(`SCRAPERAPI_ULTRA`/`SCRAPINGBEE_STEALTH`/`SCRAPEDO_SUPER`) por enquanto.

**Importante:** é *no-op* enquanto não houver credencial no ambiente. Os
workflows já mandam `SCRAPING_API_HOSTS: comix.to,comix.ws`, mas nada é
roteado (nem custa crédito) até uma das secrets de chave existir.

## Como ativar

1. Criar conta e pegar a credencial de pelo menos um provider:
   - ScraperAPI → `SCRAPERAPI_KEY` (o "API Key" do dashboard).
   - ScrapingBee → `SCRAPINGBEE_KEY` (o "API Key" do dashboard).
   - scrape.do → `SCRAPEDO_TOKEN` (o "Token" do dashboard).

2. Adicionar como **secrets do repositório** no GitHub
   (Settings → Secrets and variables → Actions → New repository secret):
   - `SCRAPERAPI_KEY`, `SCRAPINGBEE_KEY`, `SCRAPEDO_TOKEN` (o que tiver; os
     ausentes são pulados na cascata).

3. Pronto. Os workflows `scraper-capitulos`, `scraper-obras` e `scraper-fontes`
   já leem essas secrets. Rodar o "Scraper - Capítulos" (ou esperar o cron das
   12h UTC) e conferir na aba Updates / no `scraper_runs`.

## Variáveis de ambiente (todas opcionais além da chave)

| Variável | Default | Efeito |
|---|---|---|
| `SCRAPING_API_HOSTS` | *(vazio)* | Hosts a rotear, separados por vírgula. Já setado nos workflows como `comix.to,comix.ws`. |
| `SCRAPERAPI_KEY` | — | Chave do ScraperAPI. Sem ela, ScraperAPI não entra. |
| `SCRAPINGBEE_KEY` | — | Chave do ScrapingBee. Sem ela, ScrapingBee não entra. |
| `SCRAPEDO_TOKEN` | — | Token do scrape.do. Sem ele, scrape.do não entra. |
| `SCRAPING_API_ORDER` | `scraperapi,scrapingbee,scrapedo` | Ordem de tentativa entre os providers configurados. Já setado nos workflows. |
| `SCRAPING_API_RENDER` | `true` | Executa JS no provider. Necessário pro challenge do Cloudflare. |
| `SCRAPERAPI_ULTRA` | `false` | `ultra_premium` no ScraperAPI (proxies residenciais; mais caro). |
| `SCRAPINGBEE_STEALTH` | `false` | `stealth_proxy=true` no ScrapingBee (proxies stealth; mais caro). |
| `SCRAPEDO_SUPER` | `false` | `super=true` no scrape.do (proxies residenciais). |

## Se ainda vier bloqueado

O default usa só `render=true`. Se o Cloudflare do comix estiver especialmente
agressivo e mesmo assim bloquear, escalar pro tier residencial ligando
`SCRAPERAPI_ULTRA=true` (ou `SCRAPEDO_SUPER=true`) — custa mais crédito por
request, então deixei desligado por padrão. Os logs do workflow mostram o
status HTTP que cada provider devolveu (`scraping_api[...]: HTTP 4xx …`), o que
ajuda a decidir.

## Custo / limites (conferir no provider, mudam com o tempo)

- Cada request renderizado consome mais de um "crédito" (rendering + eventual
  residencial). O catálogo pagina, então uma varredura completa de `obras`
  consome vários requests — por isso o roteamento é **por host**: só o comix
  gasta, o resto do scraper continua direto e grátis.
- O estágio de **capítulos** é 1 request por fonte comix cadastrada (hoje ~18),
  uma vez por dia — bem dentro de qualquer free tier.
- O estágio de **catálogo** (`update_obras`, disparado à mão) é o que mais
  consome, por paginar o acervo inteiro. Rodar com parcimônia enquanto no
  plano grátis.

## Estado da validação

- **ScraperAPI + scrape.do**: validados ao vivo na run de capítulos de 30/07
  (15/18 pelo ScraperAPI, 3/18 pelo scrape.do no fallthrough). O bypass do
  Cloudflare do comix funciona.
- **ScrapingBee**: auth por header `Authorization: Bearer <chave>` +
  `render_js` na query (confirmado contra o sample do dashboard do usuário — é
  header Bearer, não `api_key`). **Ainda não exercitado ao vivo** (é o 2º na
  ordem, só chamado quando o ScraperAPI falha, ~3/18); a 1ª vez que cair nele
  confirma. Não passamos `json_response` (embrulharia a resposta e quebraria o
  parser) nem `country_code`.
- **Catálogo/busca** (`update_obras`/`discover_fontes`): **DESLIGADO de
  propósito — o comix é chapters-only.** A rota de listagem (`/api/v1/manga`) é
  um endpoint **Laravel** que só devolve JSON pra request com cara de XHR
  (`X-Requested-With: XMLHttpRequest`). Através das APIs de scraping com render,
  o provider faz uma **navegação de página** (sem esse header), então a API
  responde 5xx. Testado sem sucesso em **três** runs de validação (30–31/07):
  - render **off** → 5xx (o Cloudflare exige JS até pra API);
  - render **on**, sem headers → 5xx (Laravel rejeita navegação);
  - render **on** + headers XHR encaminhados (`keep_headers`/`forward_headers`/
    `customHeaders`) → **ainda 5xx** (com render, o provider navega em vez de
    fazer um XHR de verdade — `sec-fetch-mode: navigate`, não `cors`).

  Como as obras do comix passaram a ser cadastradas por outro caminho, não vale
  queimar crédito varrendo esse catálogo. `ComixAdapter.listar_catalogo`/
  `.buscar` retornam vazio enquanto `COMIX_CATALOGO_ATIVO` não for `true` (ver
  `_catalogo_ativo`). **Todo o código de catálogo/busca segue no adaptador, só
  dorme** — se um dia a rota abrir (API key/allow-list do comix, ou browser
  real via FlareSolverr), é só religar a env. O estágio de **capítulos** não
  depende de nada disto e continua funcionando ao vivo (lê o `#initial-data`).

## Catálogo via export manual do navegador (o "outro jeito")

Como o servidor não consegue ler o catálogo (seção acima), a alternativa é um
script que roda **no seu navegador**, na aba do comix.to já logada — ali o
Cloudflare já está resolvido (cookie da sua sessão) e o `fetch` é same-origin
de verdade, então os dois obstáculos somem de graça. É o mesmo raciocínio de
extensões tipo [comix-downloader](https://github.com/N3uralCreativity/comix-downloader),
só que pra exportar a lista da biblioteca em vez de baixar capítulos.

1. **Instalar um gerenciador de userscript** no navegador (ex.:
   [Tampermonkey](https://www.tampermonkey.net/)), se ainda não tiver.
2. **Instalar o script** `scraper/comix_library_export.user.js` deste repo
   (Tampermonkey → Criar novo script → colar o conteúdo do arquivo → salvar).
3. **Abrir qualquer página do comix.to** (logado ou não — o catálogo é
   público) e clicar no botão roxo "Exportar biblioteca comix" que aparece no
   canto superior direito. Ele pagina `/api/v1/manga` até o fim e baixa um
   `comix_catalogo_<data>.json` com `title`/`altTitles`/`url` de cada obra.
4. **Importar no Supabase** rodando, na pasta `scraper/` (com `.env`
   configurado como qualquer outro script daqui):
   ```
   python import_comix_catalogo.py ~/Downloads/comix_catalogo_2026-08-01.json
   ```
   Casa cada obra sem fonte no comix.to contra o catálogo exportado — por
   título principal **e** alternativos, reusando exatamente a mesma lógica de
   score/limiares de `update_obras.py` — e insere as fontes casadas (aprovada
   ou pendente, conforme o score). Registra uma run em `scraper_runs` (tipo
   `obras`, site `comix.to`), então aparece na aba Updates normalmente.

É um passo manual/sob demanda (não um cron automático), mas grátis, confiável
e usa o único caminho que de fato funciona pra esse catálogo. Os
**capítulos** das fontes já casadas continuam atualizando sozinhos todo dia,
sem precisar repetir isso.
