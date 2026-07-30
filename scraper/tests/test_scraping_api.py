"""Testes do roteamento opcional por API de scraping (scraping_api.py).
Nenhum teste toca a rede: a 'sessão' é um dublê que grava as chamadas."""

import pytest

import scraping_api


@pytest.fixture(autouse=True)
def _limpa_env(monkeypatch):
    # Cada teste começa sem nenhuma env de scraping definida.
    for var in (
        "SCRAPING_API_HOSTS",
        "SCRAPERAPI_KEY",
        "SCRAPINGBEE_KEY",
        "SCRAPEDO_TOKEN",
        "SCRAPING_API_ORDER",
        "SCRAPING_API_RENDER",
        "SCRAPERAPI_ULTRA",
        "SCRAPINGBEE_STEALTH",
        "SCRAPEDO_SUPER",
    ):
        monkeypatch.delenv(var, raising=False)


class RespFake:
    def __init__(self, status_code, text="corpo"):
        self.status_code = status_code
        self.text = text

    @property
    def ok(self):
        return 200 <= self.status_code < 300


class SessaoFake:
    def __init__(self, respostas):
        # respostas: lista de RespFake OU Exception, na ordem em que serão devolvidas.
        self._respostas = list(respostas)
        self.chamadas = []

    def get(self, base, params=None, headers=None, timeout=None):
        self.chamadas.append({"base": base, "params": params, "headers": headers, "timeout": timeout})
        r = self._respostas.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


# --- deve_rotear -------------------------------------------------------------


def test_no_op_sem_nada(monkeypatch):
    assert scraping_api.deve_rotear("https://comix.to/title/x") is False


def test_host_listado_mas_sem_chave_nao_roteia(monkeypatch):
    monkeypatch.setenv("SCRAPING_API_HOSTS", "comix.to,comix.ws")
    assert scraping_api.deve_rotear("https://comix.to/title/x") is False


def test_host_e_chave_roteia(monkeypatch):
    monkeypatch.setenv("SCRAPING_API_HOSTS", "comix.to,comix.ws")
    monkeypatch.setenv("SCRAPERAPI_KEY", "K")
    assert scraping_api.deve_rotear("https://comix.to/title/x") is True
    assert scraping_api.deve_rotear("https://www.comix.to/title/x") is True
    # host fora da lista não roteia, mesmo com chave
    assert scraping_api.deve_rotear("https://ezmanga.org/series/x") is False


# --- _target -----------------------------------------------------------------


def test_target_sem_params():
    assert scraping_api._target("https://comix.to/x", None) == "https://comix.to/x"
    assert scraping_api._target("https://comix.to/x", {}) == "https://comix.to/x"


def test_target_dobra_params():
    alvo = scraping_api._target("https://comix.to/api/v1/manga", {"page": 1, "limit": 100})
    assert alvo == "https://comix.to/api/v1/manga?page=1&limit=100"


def test_target_respeita_query_existente():
    alvo = scraping_api._target("https://comix.to/api?a=1", {"b": 2})
    assert alvo == "https://comix.to/api?a=1&b=2"


# --- builders ----------------------------------------------------------------


def test_scraperapi_render_default_on(monkeypatch):
    monkeypatch.setenv("SCRAPERAPI_KEY", "K")
    base, params, headers = scraping_api._construir_scraperapi("https://comix.to/x")
    assert base == "https://api.scraperapi.com/"
    assert params == {"api_key": "K", "url": "https://comix.to/x", "render": "true"}
    assert headers is None


def test_scraperapi_render_off_e_ultra(monkeypatch):
    monkeypatch.setenv("SCRAPERAPI_KEY", "K")
    monkeypatch.setenv("SCRAPING_API_RENDER", "false")
    monkeypatch.setenv("SCRAPERAPI_ULTRA", "true")
    _, params, _ = scraping_api._construir_scraperapi("https://comix.to/x")
    assert "render" not in params
    assert params["ultra_premium"] == "true"


def test_scrapedo_token_e_super(monkeypatch):
    monkeypatch.setenv("SCRAPEDO_TOKEN", "T")
    monkeypatch.setenv("SCRAPEDO_SUPER", "true")
    base, params, headers = scraping_api._construir_scrapedo("https://comix.to/x")
    assert base == "https://api.scrape.do/"
    assert params == {"token": "T", "url": "https://comix.to/x", "render": "true", "super": "true"}
    assert headers is None


def test_scrapingbee_bearer_header_e_render(monkeypatch):
    monkeypatch.setenv("SCRAPINGBEE_KEY", "B")
    base, params, headers = scraping_api._construir_scrapingbee("https://comix.to/x")
    assert base == "https://app.scrapingbee.com/api/v1"
    # Auth por header Bearer, NÃO api_key na query.
    assert headers == {"Authorization": "Bearer B"}
    assert params == {"url": "https://comix.to/x", "render_js": "true"}
    assert "api_key" not in params


def test_scrapingbee_render_off_e_stealth(monkeypatch):
    monkeypatch.setenv("SCRAPINGBEE_KEY", "B")
    monkeypatch.setenv("SCRAPING_API_RENDER", "false")
    monkeypatch.setenv("SCRAPINGBEE_STEALTH", "true")
    _, params, headers = scraping_api._construir_scrapingbee("https://comix.to/x")
    assert params["render_js"] == "false"
    assert params["stealth_proxy"] == "true"
    assert headers == {"Authorization": "Bearer B"}


def test_scrapingbee_manda_o_header_no_get(monkeypatch):
    # Confirma que o Bearer chega no sessao.get (não só no builder).
    monkeypatch.setenv("SCRAPINGBEE_KEY", "B")
    monkeypatch.setenv("SCRAPING_API_ORDER", "scrapingbee")
    sessao = SessaoFake([RespFake(200, "ok")])
    scraping_api.buscar(sessao, "https://comix.to/x")
    assert sessao.chamadas[0]["headers"] == {"Authorization": "Bearer B"}
    assert sessao.chamadas[0]["base"] == "https://app.scrapingbee.com/api/v1"


# --- buscar (ordem / fallthrough) --------------------------------------------


def test_buscar_primeiro_provider_ok(monkeypatch):
    monkeypatch.setenv("SCRAPERAPI_KEY", "K")
    monkeypatch.setenv("SCRAPEDO_TOKEN", "T")
    sessao = SessaoFake([RespFake(200, "html-ok")])
    resp = scraping_api.buscar(sessao, "https://comix.to/x")
    assert resp.text == "html-ok"
    assert len(sessao.chamadas) == 1
    assert sessao.chamadas[0]["base"] == "https://api.scraperapi.com/"


def test_buscar_cai_pro_segundo_quando_o_primeiro_falha(monkeypatch):
    # Simula trial do ScraperAPI esgotado (403) caindo pro scrape.do.
    monkeypatch.setenv("SCRAPERAPI_KEY", "K")
    monkeypatch.setenv("SCRAPEDO_TOKEN", "T")
    sessao = SessaoFake([RespFake(403), RespFake(200, "html-do")])
    resp = scraping_api.buscar(sessao, "https://comix.to/x")
    assert resp.text == "html-do"
    assert [c["base"] for c in sessao.chamadas] == [
        "https://api.scraperapi.com/",
        "https://api.scrape.do/",
    ]


def test_buscar_ordem_customizada(monkeypatch):
    monkeypatch.setenv("SCRAPERAPI_KEY", "K")
    monkeypatch.setenv("SCRAPEDO_TOKEN", "T")
    monkeypatch.setenv("SCRAPING_API_ORDER", "scrapedo,scraperapi")
    sessao = SessaoFake([RespFake(200, "html-do")])
    scraping_api.buscar(sessao, "https://comix.to/x")
    assert sessao.chamadas[0]["base"] == "https://api.scrape.do/"


def test_buscar_ordem_tres_providers_scraperapi_scrapingbee_scrapedo(monkeypatch):
    # A ordem pedida pelo usuário: queima o ScraperAPI (crédito que expira)
    # primeiro, ScrapingBee em seguida, scrape.do por último. Aqui os dois
    # primeiros falham (500) e o terceiro entrega — confirma a cascata inteira.
    monkeypatch.setenv("SCRAPERAPI_KEY", "K")
    monkeypatch.setenv("SCRAPINGBEE_KEY", "B")
    monkeypatch.setenv("SCRAPEDO_TOKEN", "T")
    monkeypatch.setenv("SCRAPING_API_ORDER", "scraperapi,scrapingbee,scrapedo")
    sessao = SessaoFake([RespFake(500), RespFake(500), RespFake(200, "html-do")])
    resp = scraping_api.buscar(sessao, "https://comix.to/x")
    assert resp.text == "html-do"
    assert [c["base"] for c in sessao.chamadas] == [
        "https://api.scraperapi.com/",
        "https://app.scrapingbee.com/api/v1",
        "https://api.scrape.do/",
    ]


def test_buscar_scraperapi_primeiro_ok_nao_chama_os_outros(monkeypatch):
    # Caso normal (o que o log da run real mostrou em 15/18): ScraperAPI
    # entrega de primeira, ScrapingBee e scrape.do nem são tocados (1 cobrança).
    monkeypatch.setenv("SCRAPERAPI_KEY", "K")
    monkeypatch.setenv("SCRAPINGBEE_KEY", "B")
    monkeypatch.setenv("SCRAPEDO_TOKEN", "T")
    monkeypatch.setenv("SCRAPING_API_ORDER", "scraperapi,scrapingbee,scrapedo")
    sessao = SessaoFake([RespFake(200, "html-api")])
    resp = scraping_api.buscar(sessao, "https://comix.to/x")
    assert resp.text == "html-api"
    assert len(sessao.chamadas) == 1
    assert sessao.chamadas[0]["base"] == "https://api.scraperapi.com/"


def test_buscar_todos_falham_devolve_ultima_resp(monkeypatch):
    monkeypatch.setenv("SCRAPERAPI_KEY", "K")
    monkeypatch.setenv("SCRAPEDO_TOKEN", "T")
    sessao = SessaoFake([RespFake(403), RespFake(402)])
    resp = scraping_api.buscar(sessao, "https://comix.to/x")
    assert resp.status_code == 402


def test_buscar_dobra_params_no_alvo(monkeypatch):
    monkeypatch.setenv("SCRAPERAPI_KEY", "K")
    sessao = SessaoFake([RespFake(200)])
    scraping_api.buscar(sessao, "https://comix.to/api/v1/manga", params={"page": 2, "limit": 100})
    assert sessao.chamadas[0]["params"]["url"] == "https://comix.to/api/v1/manga?page=2&limit=100"
