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

Suporta dois providers, na ordem em que se quiser: **ScraperAPI** e
**scrape.do**. Ambos têm plano grátis (trial/mensal). A ordem é o que permite
"usar o trial do ScraperAPI e, quando esgotar, cair no free tier do scrape.do"
sem trocar código — quando o primeiro provider devolve erro de cota, o próximo
é tentado automaticamente.

**Importante:** é *no-op* enquanto não houver credencial no ambiente. Os
workflows já mandam `SCRAPING_API_HOSTS: comix.to,comix.ws`, mas nada é
roteado (nem custa crédito) até uma das secrets de chave existir.

## Como ativar

1. Criar conta e pegar a credencial de pelo menos um provider:
   - ScraperAPI → `SCRAPERAPI_KEY` (o "API Key" do dashboard).
   - scrape.do → `SCRAPEDO_TOKEN` (o "Token" do dashboard).

2. Adicionar como **secrets do repositório** no GitHub
   (Settings → Secrets and variables → Actions → New repository secret):
   - `SCRAPERAPI_KEY`
   - `SCRAPEDO_TOKEN` (opcional; adicione quando for usar o fallback)

3. Pronto. Os workflows `scraper-capitulos`, `scraper-obras` e `scraper-fontes`
   já leem essas secrets. Rodar o "Scraper - Capítulos" (ou esperar o cron das
   12h UTC) e conferir na aba Updates / no `scraper_runs`.

## Variáveis de ambiente (todas opcionais além da chave)

| Variável | Default | Efeito |
|---|---|---|
| `SCRAPING_API_HOSTS` | *(vazio)* | Hosts a rotear, separados por vírgula. Já setado nos workflows como `comix.to,comix.ws`. |
| `SCRAPERAPI_KEY` | — | Chave do ScraperAPI. Sem ela, ScraperAPI não entra. |
| `SCRAPEDO_TOKEN` | — | Token do scrape.do. Sem ele, scrape.do não entra. |
| `SCRAPING_API_ORDER` | `scraperapi,scrapedo` | Ordem de tentativa entre os providers configurados. |
| `SCRAPING_API_RENDER` | `true` | Executa JS no provider. Necessário pro challenge do Cloudflare. |
| `SCRAPERAPI_ULTRA` | `false` | `ultra_premium` no ScraperAPI (proxies residenciais; mais caro). |
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

## O que não foi testado

Não consegui validar o bypass ao vivo daqui: sem uma chave real, e o acesso a
comix.to segue bloqueado neste ambiente. A lógica de roteamento/ordem/fallback
tem testes (`scraper/tests/test_scraping_api.py`, sem rede), mas a confirmação
de que o provider realmente passa do Cloudflare do comix só acontece na
primeira run com a secret configurada.
