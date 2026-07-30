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
        "SCRAPEDO_TOKEN",
        "SCRAPING_API_ORDER",
        "SCRAPING_API_RENDER",
        "SCRAPERAPI_ULTRA",
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

    def get(self, base, params=None, timeout=None):
        self.chamadas.append({"base": base, "params": params, "timeout": timeout})
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
    base, params = scraping_api._construir_scraperapi("https://comix.to/x")
    assert base == "https://api.scraperapi.com/"
    assert params == {"api_key": "K", "url": "https://comix.to/x", "render": "true"}


def test_scraperapi_render_off_e_ultra(monkeypatch):
    monkeypatch.setenv("SCRAPERAPI_KEY", "K")
    monkeypatch.setenv("SCRAPING_API_RENDER", "false")
    monkeypatch.setenv("SCRAPERAPI_ULTRA", "true")
    _, params = scraping_api._construir_scraperapi("https://comix.to/x")
    assert "render" not in params
    assert params["ultra_premium"] == "true"


def test_scrapedo_token_e_super(monkeypatch):
    monkeypatch.setenv("SCRAPEDO_TOKEN", "T")
    monkeypatch.setenv("SCRAPEDO_SUPER", "true")
    base, params = scraping_api._construir_scrapedo("https://comix.to/x")
    assert base == "https://api.scrape.do/"
    assert params == {"token": "T", "url": "https://comix.to/x", "render": "true", "super": "true"}


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
