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

- **Fallback pro acesso direto.** Quando TODOS os providers falham, `buscar`
  devolve None e `common.http_get` refaz o GET pelo caminho direto de sempre,
  em vez de propagar o erro do provider. Sem isso, credencial vencida/cota
  estourada em todos os providers derruba 100% do domínio roteado mesmo
  quando o site responde normalmente sem intermediário — foi exatamente o que
  aconteceu com o comix.to (ScraperAPI 403 + ScrapingBee 401 + scrape.do 401
  em 273/273 fontes, enquanto comix.to servia o `#initial-data` direto, com
  200). O roteamento continua sendo a primeira opção: se o Cloudflare voltar
  a exigir JS, os providers seguem cobrindo o caso quando tiverem crédito.

- **Stand-by.** `SCRAPING_API_STANDBY=true` desliga o roteamento sem apagar
  nada: `deve_rotear()` devolve False e tudo vai pelo acesso direto, sem
  gastar uma chamada (nem crédito) por URL. É o estado atual do comix, que
  voltou a responder direto. Pra religar — se o Cloudflare reaparecer — basta
  tirar a env e repor as secrets; o caminho continua aqui, testado.

  O stand-by não é cego: quando um host configurado em `SCRAPING_API_HOSTS`
  leva bloqueio no acesso direto, `registrar_necessidade()` anota, e o fim da
  run grava um alerta que a aba Updates mostra ("renove as chaves"). Sem isso,
  desligar o roteamento trocaria "gasta crédito à toa" por "para de funcionar
  em silêncio".

  Dois sinais alimentam esse alerta, porque um só não cobre tudo:
  `registrar_necessidade()` pega o bloqueio explícito (403/challenge), e
  `avaliar_taxa_sem_capitulo()` pega o caso silencioso — o site responde 200
  mas para de entregar capítulo (mudou o HTML, passou a exigir JS).

- **Disjuntor por processo.** Se os providers falharem em bloco
  `_LIMITE_FALHAS_SEGUIDAS` vezes seguidas, o roteamento é desligado pelo
  resto do processo (`deve_rotear` passa a devolver False) e tudo segue
  direto. Evita queimar minutos de run repetindo 3 chamadas mortas por URL
  em centenas de fontes; qualquer sucesso zera o contador.

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

# Disjuntor por processo: quantas vezes seguidas TODOS os providers podem
# falhar antes de o roteamento ser desligado pelo resto da run. 3 é o bastante
# pra separar "credencial morta / cota estourada" (falha em toda URL) de um
# tropeço pontual num alvo específico.
_LIMITE_FALHAS_SEGUIDAS = 3

_falhas_seguidas = 0
_desligado_no_processo = False


def _registrar_sucesso() -> None:
    """Zera o contador do disjuntor: algum provider voltou a responder."""
    global _falhas_seguidas
    _falhas_seguidas = 0


def _registrar_falha_total() -> None:
    """
    Conta uma rodada em que NENHUM provider respondeu OK. No limite, desliga o
    roteamento pelo resto do processo — daí em diante tudo vai direto, sem
    gastar ~1 request morta por provider em cada uma das centenas de fontes.
    """
    global _falhas_seguidas, _desligado_no_processo
    _falhas_seguidas += 1
    if _falhas_seguidas >= _LIMITE_FALHAS_SEGUIDAS and not _desligado_no_processo:
        _desligado_no_processo = True
        print(
            f"  scraping_api: {_falhas_seguidas} falhas seguidas em todos os providers — "
            "roteamento desligado nesta run, seguindo pelo acesso direto",
            file=sys.stderr,
        )


def resetar_estado() -> None:
    """Zera disjuntor e necessidades (testes; cada run de produção é processo novo)."""
    global _falhas_seguidas, _desligado_no_processo
    _falhas_seguidas = 0
    _desligado_no_processo = False
    _necessidades.clear()


# host -> diagnóstico do bloqueio no acesso direto. Preenchido por
# `registrar_necessidade`; lido no fim da run pra gravar o alerta.
_necessidades: dict[str, str] = {}


def em_standby() -> bool:
    """True quando o roteamento está desligado de propósito (SCRAPING_API_STANDBY)."""
    return _env_flag("SCRAPING_API_STANDBY", False)


def registrar_necessidade(url: str, diagnostico: str | None = None) -> None:
    """
    Anota que um host configurado pra roteamento levou bloqueio no acesso
    direto — ou seja, o caminho pago faria falta aqui.

    Só conta pra host listado em `SCRAPING_API_HOSTS`: bloqueio em domínio que
    nunca foi roteado não é problema de credencial, é um site novo atrás de
    challenge, e pedir renovação de chave nesse caso seria ruído.
    """
    host = _host_de(url)
    if not host or host not in _hosts_configurados():
        return
    _necessidades.setdefault(host, diagnostico or "acesso bloqueado")


def necessidades() -> dict[str, str]:
    """Hosts que precisaram do caminho pago nesta run (host -> diagnóstico)."""
    return dict(_necessidades)


# Fração de fontes sem capítulo, num domínio, a partir da qual a run entende
# que o site parou de responder de verdade — e não que algumas obras
# simplesmente ainda não têm capítulo publicado.
#
# Calibrado no log real da run de 29/08: o comix saudável fica em ~4,7% sem
# capítulo (20 de 430 obras sem capítulo publicado) e, bloqueado, foi a 100%.
# 50% é 10x a linha de base e ainda pega quebra PARCIAL — o Cloudflare costuma
# barrar de forma intermitente, e esperar 90% deixaria meia base quebrada em
# silêncio.
LIMIAR_SEM_CAPITULO = 0.5

# Piso de fontes avaliadas pra a fração significar alguma coisa: num domínio
# com 2 fontes, uma obra sem capítulo já daria 50%.
MINIMO_FONTES_AVALIADAS = 10


def avaliar_taxa_sem_capitulo(host: str, avaliadas: int, sem_capitulo: int) -> bool:
    """
    Fecha o buraco que o sinal de bloqueio não cobre: um site pode responder
    200 e ainda assim não entregar capítulo nenhum (mudou o HTML, passou a
    exigir JS, devolve página vazia pra quem não passa no challenge). Nesse
    caso `fetch_http` nunca marca 'acesso_bloqueado' e o alerta jamais subiria.

    Só vale pra host configurado em SCRAPING_API_HOSTS, como
    `registrar_necessidade`. Aplicar isso a qualquer domínio seria ruído: no
    log real, 31 dos 55 domínios ficam em 100% sem capítulo de forma
    permanente (webtoons, manta, tappytoon, mangadex…) — o scraper nunca
    conseguiu ler esses sites, não é regressão.

    Devolve True quando registrou.
    """
    if not host or host.lower().removeprefix("www.") not in _hosts_configurados():
        return False
    if avaliadas < MINIMO_FONTES_AVALIADAS or sem_capitulo <= 0:
        return False
    fracao = sem_capitulo / avaliadas
    if fracao < LIMIAR_SEM_CAPITULO:
        return False
    _necessidades.setdefault(
        host.lower().removeprefix("www."),
        f"{sem_capitulo} de {avaliadas} fontes ({fracao:.0%}) sem capítulo",
    )
    return True


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
    """
    True se o host da URL está listado, há ao menos um provider com chave, o
    roteamento não está em stand-by (SCRAPING_API_STANDBY) E o disjuntor não o
    desligou nesta run (ver _registrar_falha_total).
    """
    if _desligado_no_processo or em_standby():
        return False
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
    Devolve o `requests.Response` do primeiro provider que responder 2xx.

    Devolve **None** quando nenhum provider entregou uma resposta OK — seja por
    erro HTTP (401/403 de credencial vencida, 402/429 de cota) ou por falha de
    rede. None é o sinal pra `common.http_get` refazer o GET pelo acesso
    direto: melhor tentar sem intermediário do que devolver o erro do provider
    como se fosse a resposta do site. Antes essa função devolvia a última
    resposta com erro, e o chamador a tratava como definitiva — foi assim que
    o comix.to ficou com 273/273 fontes em "HTTP 401" enquanto respondia 200
    no acesso direto.

    Só deve ser chamado quando `deve_rotear(url)` é True.
    """
    alvo = _target(url, params)
    houve_tentativa = False
    for nome, construir in _provedores_ativos():
        houve_tentativa = True
        base, pparams, pheaders = construir(alvo)
        try:
            resp = sessao.get(base, params=pparams, headers=pheaders, timeout=SCRAPING_TIMEOUT)
        except Exception as exc:  # noqa: BLE001 - rede/provider fora do ar: tenta o próximo
            print(f"  scraping_api[{nome}]: falha de rede em {alvo}: {exc}", file=sys.stderr)
            continue
        if resp.ok:
            _registrar_sucesso()
            return resp
        print(
            f"  scraping_api[{nome}]: HTTP {resp.status_code} pra {alvo} — tentando próximo provider",
            file=sys.stderr,
        )

    if houve_tentativa:
        _registrar_falha_total()
        print(f"  scraping_api: nenhum provider respondeu pra {alvo} — caindo pro acesso direto", file=sys.stderr)
    return None
