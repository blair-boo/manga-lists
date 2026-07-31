"""
Roteamento opcional de requests por uma API de scraping (ScraperAPI /
scrape.do), pra sites que ficam atrás de um challenge JS do Cloudflare que o
cliente HTTP direto (requests/cloudscraper/curl) não resolve — o caso do
comix.to (ver HANDOUT_SCRAPER_COMIX e a investigação em update_fontes).

Desenho:

- **Por host, não global.** Só as URLs cujo host está em `SCRAPING_API_HOSTS`
  passam pela API paga. Todo o resto do scraper segue direto, sem gastar
  crédito. Isso mantém o custo restrito ao(s) domínio(s) que realmente
  precisam.

- **No-op sem chave.** Se nenhum provider tem credencial no ambiente, ou o
  host não está listado, `deve_rotear()` devolve False e o `http_get` se
  comporta exatamente como antes. Commitar a config de host é seguro: só
  ativa quando existe a secret.

- **Multi-provider com fallthrough.** `SCRAPING_API_ORDER` (default
  "scraperapi,scrapedo") define a ordem; só entram os providers com chave.
  Tenta um a um até um responder OK. É o que cobre "usa o trial do ScraperAPI
  e, quando acabar, cai no free tier do scrape.do": quando o primeiro devolve
  erro (402/403 de cota esgotada), o próximo é tentado automaticamente, sem
  troca de código — só a ordem/credenciais no ambiente.

- **Cobre os três estágios de uma vez.** Como capítulos (`fetch_http`),
  catálogo (`ComixAdapter._consultar`) e descoberta (`adapter.buscar`) todos
  passam por `common.http_get`, rotear lá dentro cobre os três sem tocar em
  cada um. Os `params` da query (ex.: os do endpoint /api/v1/manga) são
  dobrados na URL-alvo antes de ir pro provider.

Variáveis de ambiente:

  SCRAPING_API_HOSTS   Lista separada por vírgula dos hosts a rotear
                       (ex.: "comix.to,comix.ws"). Sem isto, nada é roteado.
  SCRAPERAPI_KEY       Chave do ScraperAPI (https://scraperapi.com).
  SCRAPINGBEE_KEY      Chave do ScrapingBee (https://scrapingbee.com).
  SCRAPEDO_TOKEN       Token do scrape.do (https://scrape.do).
  SCRAPING_API_ORDER   Ordem de tentativa (default
                       "scraperapi,scrapingbee,scrapedo").
  SCRAPING_API_RENDER  "true"/"false" — executa JS no provider (default true;
                       necessário pra passar do interstitial "Just a moment"
                       do Cloudflare).
  SCRAPERAPI_ULTRA     "true" -> ultra_premium no ScraperAPI (proxies
                       residenciais; mais caro, pra anti-bot mais duro).
  SCRAPINGBEE_STEALTH  "true" -> stealth_proxy=true no ScrapingBee (proxies
                       stealth; mais caro, anti-bot mais duro).
  SCRAPEDO_SUPER       "true" -> super=true no scrape.do (proxies
                       residenciais; equivalente ao ultra do ScraperAPI).

Timeout maior de propósito: renderizar no provider leva dezenas de segundos.
"""

import os
import sys
from urllib.parse import urlencode, urlparse

SCRAPING_TIMEOUT = 75


def _env_flag(nome: str, padrao: bool = False) -> bool:
    valor = os.environ.get(nome)
    if valor is None:
        return padrao
    return valor.strip().lower() in ("1", "true", "yes", "on")


def _hosts_configurados() -> set[str]:
    bruto = os.environ.get("SCRAPING_API_HOSTS", "")
    return {
        h.strip().lower().removeprefix("www.")
        for h in bruto.split(",")
        if h.strip()
    }


def _host_de(url: str) -> str:
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return ""
    return host.removeprefix("www.")


def _render_para(target: str) -> bool:
    """
    Se deve pedir execução de JS no provider pra ESTE alvo.

    Render pra tudo no comix (o Cloudflare exige JS). O endpoint JSON também
    renderiza — o JSON volta embrulhado em HTML e `ComixAdapter._extrair_json`
    desembrulha.
    """
    return _env_flag("SCRAPING_API_RENDER", True)


def _headers_xhr(target: str) -> dict | None:
    """
    Headers a encaminhar pro alvo quando é o endpoint JSON (`/api/...`). O comix
    roda Laravel: a rota só devolve JSON pra request com cara de XHR
    (`X-Requested-With: XMLHttpRequest` + `Accept: application/json`).
    Confirmado pelo cURL real do navegador do usuário (2026-07-31). Sem esses
    headers, o provider renderiza uma NAVEGAÇÃO de página (sem eles) e a API
    responde 5xx — o motivo real do catálogo falhar (não era o Cloudflare, que
    o render já resolve). Páginas HTML (capítulos) não precisam disso -> None.
    """
    try:
        parsed = urlparse(target)
    except ValueError:
        return None
    if "/api/" not in (parsed.path or ""):
        return None
    host = parsed.hostname or "comix.to"
    return {
        "Accept": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": f"https://{host}/browse",
    }


# Cada builder devolve (base_url, query_params, headers). `headers` carrega a
# auth do provider (ScrapingBee usa Bearer) e/ou os headers XHR encaminhados
# pro alvo (endpoint JSON). Cada provider tem seu jeito de encaminhar headers.
def _construir_scraperapi(target: str) -> tuple[str, dict, dict | None]:
    params = {"api_key": os.environ["SCRAPERAPI_KEY"], "url": target}
    if _render_para(target):
        params["render"] = "true"
    if _env_flag("SCRAPERAPI_ULTRA", False):
        params["ultra_premium"] = "true"
    headers = None
    xhr = _headers_xhr(target)
    if xhr:
        # keep_headers=true faz o ScraperAPI repassar os headers que a gente
        # manda, em vez de usar só os dele.
        params["keep_headers"] = "true"
        headers = xhr
    return "https://api.scraperapi.com/", params, headers


def _construir_scrapingbee(target: str) -> tuple[str, dict, dict | None]:
    # Auth por header `Authorization: Bearer <chave>` (confirmado no sample do
    # dashboard do usuário — NÃO é api_key na query string). `render_js` liga a
    # execução de JS (necessária pro challenge do Cloudflare); `stealth_proxy`
    # é o modo anti-bot mais forte (caro), opt-in. Não passamos `json_response`
    # (embrulharia a resposta num envelope JSON e quebraria o parser) nem
    # `country_code` (o comix é global).
    params = {"url": target}
    params["render_js"] = "true" if _render_para(target) else "false"
    if _env_flag("SCRAPINGBEE_STEALTH", False):
        params["stealth_proxy"] = "true"
    headers = {"Authorization": f"Bearer {os.environ['SCRAPINGBEE_KEY']}"}
    xhr = _headers_xhr(target)
    if xhr:
        # ScrapingBee encaminha headers prefixados com `Spb-` quando
        # forward_headers=true.
        params["forward_headers"] = "true"
        for k, v in xhr.items():
            headers[f"Spb-{k}"] = v
    return "https://app.scrapingbee.com/api/v1", params, headers


def _construir_scrapedo(target: str) -> tuple[str, dict, dict | None]:
    params = {"token": os.environ["SCRAPEDO_TOKEN"], "url": target}
    if _render_para(target):
        params["render"] = "true"
    if _env_flag("SCRAPEDO_SUPER", False):
        params["super"] = "true"
    headers = None
    xhr = _headers_xhr(target)
    if xhr:
        # scrape.do repassa os headers enviados quando customHeaders=true.
        params["customHeaders"] = "true"
        headers = xhr
    return "https://api.scrape.do/", params, headers


# nome -> (env da credencial, builder). A ordem real vem de SCRAPING_API_ORDER.
_PROVEDORES = {
    "scraperapi": ("SCRAPERAPI_KEY", _construir_scraperapi),
    "scrapingbee": ("SCRAPINGBEE_KEY", _construir_scrapingbee),
    "scrapedo": ("SCRAPEDO_TOKEN", _construir_scrapedo),
}


def _provedores_ativos() -> list[tuple[str, callable]]:
    """(nome, builder) dos providers com credencial, na ordem configurada."""
    ordem = os.environ.get("SCRAPING_API_ORDER", "scraperapi,scrapingbee,scrapedo")
    ativos: list[tuple[str, callable]] = []
    for nome in (n.strip().lower() for n in ordem.split(",")):
        entrada = _PROVEDORES.get(nome)
        if entrada and os.environ.get(entrada[0]):
            ativos.append((nome, entrada[1]))
    return ativos


def deve_rotear(url: str) -> bool:
    """True se o host da URL está listado E há ao menos um provider com chave."""
    return _host_de(url) in _hosts_configurados() and bool(_provedores_ativos())


def _target(url: str, params) -> str:
    """URL-alvo com os params da query dobrados dentro (o provider recebe uma
    URL única no parâmetro `url`)."""
    if not params:
        return url
    sep = "&" if urlparse(url).query else "?"
    return url + sep + urlencode(params, doseq=True)


def buscar(sessao, url: str, params=None):
    """
    Faz o GET da `url` (com `params`) através dos providers ativos, em ordem.
    Devolve o `requests.Response` do primeiro provider que responder 2xx; se
    todos falharem, devolve a última resposta recebida (pra o chamador ver o
    status), ou levanta a última exceção de rede se nenhum respondeu.

    Só deve ser chamado quando `deve_rotear(url)` é True.
    """
    alvo = _target(url, params)
    ultima_resp = None
    ultima_exc = None
    for nome, construir in _provedores_ativos():
        base, pparams, pheaders = construir(alvo)
        try:
            resp = sessao.get(base, params=pparams, headers=pheaders, timeout=SCRAPING_TIMEOUT)
        except Exception as exc:  # noqa: BLE001 - rede/provider fora do ar: tenta o próximo
            ultima_exc = exc
            print(f"  scraping_api[{nome}]: falha de rede em {alvo}: {exc}", file=sys.stderr)
            continue
        if resp.ok:
            return resp
        ultima_resp = resp
        print(
            f"  scraping_api[{nome}]: HTTP {resp.status_code} pra {alvo} — tentando próximo provider",
            file=sys.stderr,
        )
    if ultima_resp is not None:
        return ultima_resp
    raise ultima_exc if ultima_exc is not None else RuntimeError("nenhum provider de scraping configurado")
