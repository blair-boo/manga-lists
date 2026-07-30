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
  SCRAPEDO_TOKEN       Token do scrape.do (https://scrape.do).
  SCRAPING_API_ORDER   Ordem de tentativa (default "scraperapi,scrapedo").
  SCRAPING_API_RENDER  "true"/"false" — executa JS no provider (default true;
                       necessário pra passar do interstitial "Just a moment"
                       do Cloudflare).
  SCRAPERAPI_ULTRA     "true" -> ultra_premium no ScraperAPI (proxies
                       residenciais; mais caro, pra anti-bot mais duro).
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


def _construir_scraperapi(target: str) -> tuple[str, dict]:
    params = {"api_key": os.environ["SCRAPERAPI_KEY"], "url": target}
    if _env_flag("SCRAPING_API_RENDER", True):
        params["render"] = "true"
    if _env_flag("SCRAPERAPI_ULTRA", False):
        params["ultra_premium"] = "true"
    return "https://api.scraperapi.com/", params


def _construir_scrapedo(target: str) -> tuple[str, dict]:
    params = {"token": os.environ["SCRAPEDO_TOKEN"], "url": target}
    if _env_flag("SCRAPING_API_RENDER", True):
        params["render"] = "true"
    if _env_flag("SCRAPEDO_SUPER", False):
        params["super"] = "true"
    return "https://api.scrape.do/", params


# nome -> (env da credencial, builder). A ordem real vem de SCRAPING_API_ORDER.
_PROVEDORES = {
    "scraperapi": ("SCRAPERAPI_KEY", _construir_scraperapi),
    "scrapedo": ("SCRAPEDO_TOKEN", _construir_scrapedo),
}


def _provedores_ativos() -> list[tuple[str, callable]]:
    """(nome, builder) dos providers com credencial, na ordem configurada."""
    ordem = os.environ.get("SCRAPING_API_ORDER", "scraperapi,scrapedo")
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
        base, pparams = construir(alvo)
        try:
            resp = sessao.get(base, params=pparams, timeout=SCRAPING_TIMEOUT)
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
