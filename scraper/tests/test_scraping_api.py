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
    # O disjuntor é estado de módulo (vive pelo processo): sem zerar, um teste
    # que estoura o limite desliga o roteamento pros seguintes.
    scraping_api.resetar_estado()


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


def test_render_on_tambem_pro_endpoint_json_api(monkeypatch):
    # O endpoint JSON /api/... TAMBÉM renderiza: o Cloudflare do comix exige JS
    # (sem render deu 5xx nos três providers). O JSON embrulhado é desembrulhado
    # depois em ComixAdapter._consultar.
    monkeypatch.setenv("SCRAPERAPI_KEY", "K")
    monkeypatch.setenv("SCRAPINGBEE_KEY", "B")
    _, params_api, _ = scraping_api._construir_scraperapi("https://comix.to/api/v1/manga?page=1")
    assert params_api["render"] == "true"
    _, bee_api, _ = scraping_api._construir_scrapingbee("https://comix.to/api/v1/manga?page=1")
    assert bee_api["render_js"] == "true"


def test_render_on_pra_pagina_html(monkeypatch):
    monkeypatch.setenv("SCRAPERAPI_KEY", "K")
    _, params_html, _ = scraping_api._construir_scraperapi("https://comix.to/title/l78rz-x")
    assert params_html["render"] == "true"


def test_headers_xhr_so_pro_endpoint_api():
    h = scraping_api._headers_xhr("https://comix.to/api/v1/manga?page=1")
    assert h == {
        "Accept": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://comix.to/browse",
    }
    # comix.ws usa o próprio host no referer
    assert scraping_api._headers_xhr("https://comix.ws/api/v1/manga")["Referer"] == "https://comix.ws/browse"
    # página HTML não recebe headers XHR
    assert scraping_api._headers_xhr("https://comix.to/title/l78rz-x") is None


def test_scraperapi_encaminha_headers_xhr_no_api(monkeypatch):
    monkeypatch.setenv("SCRAPERAPI_KEY", "K")
    _, params, headers = scraping_api._construir_scraperapi("https://comix.to/api/v1/manga?page=1")
    assert params["keep_headers"] == "true"
    assert headers["Accept"] == "application/json"
    assert headers["X-Requested-With"] == "XMLHttpRequest"


def test_scrapingbee_encaminha_headers_xhr_com_prefixo_spb(monkeypatch):
    monkeypatch.setenv("SCRAPINGBEE_KEY", "B")
    _, params, headers = scraping_api._construir_scrapingbee("https://comix.to/api/v1/manga?page=1")
    assert params["forward_headers"] == "true"
    assert headers["Authorization"] == "Bearer B"
    assert headers["Spb-Accept"] == "application/json"
    assert headers["Spb-X-Requested-With"] == "XMLHttpRequest"


def test_scrapedo_encaminha_headers_xhr_no_api(monkeypatch):
    monkeypatch.setenv("SCRAPEDO_TOKEN", "T")
    _, params, headers = scraping_api._construir_scrapedo("https://comix.to/api/v1/manga?page=1")
    assert params["customHeaders"] == "true"
    assert headers["X-Requested-With"] == "XMLHttpRequest"


def test_pagina_html_nao_ganha_headers_xhr(monkeypatch):
    # Capítulos (HTML) seguem sem keep_headers/forward_headers.
    monkeypatch.setenv("SCRAPERAPI_KEY", "K")
    _, params, headers = scraping_api._construir_scraperapi("https://comix.to/title/l78rz-x")
    assert "keep_headers" not in params
    assert headers is None


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


# --- fallback pro acesso direto ----------------------------------------------


def test_buscar_todos_falham_devolve_none(monkeypatch):
    """
    Todos os providers com erro -> None, e não a última resposta com erro.
    None é o sinal pra common.http_get refazer o GET direto. Devolver a
    resposta do provider fazia o chamador tratar "401 do scrape.do" como se
    fosse a resposta do site — o bug que matou 273/273 fontes do comix.to.
    """
    monkeypatch.setenv("SCRAPERAPI_KEY", "K")
    monkeypatch.setenv("SCRAPEDO_TOKEN", "T")
    sessao = SessaoFake([RespFake(403), RespFake(402)])
    assert scraping_api.buscar(sessao, "https://comix.to/x") is None


def test_buscar_credenciais_mortas_nos_tres_devolve_none(monkeypatch):
    """Cenário exato da run de 29/08: 403 + 401 + 401 nos três providers."""
    monkeypatch.setenv("SCRAPERAPI_KEY", "K")
    monkeypatch.setenv("SCRAPINGBEE_KEY", "B")
    monkeypatch.setenv("SCRAPEDO_TOKEN", "T")
    monkeypatch.setenv("SCRAPING_API_ORDER", "scraperapi,scrapingbee,scrapedo")
    sessao = SessaoFake([RespFake(403), RespFake(401), RespFake(401)])
    assert scraping_api.buscar(sessao, "https://comix.to/title/x") is None
    assert len(sessao.chamadas) == 3


def test_buscar_todos_com_erro_de_rede_devolve_none(monkeypatch):
    """Provider fora do ar (exceção, não resposta) também cai pro direto."""
    monkeypatch.setenv("SCRAPERAPI_KEY", "K")
    monkeypatch.setenv("SCRAPEDO_TOKEN", "T")
    sessao = SessaoFake([RuntimeError("timeout"), RuntimeError("conexão recusada")])
    assert scraping_api.buscar(sessao, "https://comix.to/x") is None


# --- disjuntor por processo ---------------------------------------------------


def test_disjuntor_desliga_roteamento_apos_falhas_seguidas(monkeypatch):
    """
    Depois de _LIMITE_FALHAS_SEGUIDAS rodadas em que nenhum provider respondeu,
    deve_rotear passa a devolver False: o resto da run vai direto, sem queimar
    uma request morta por provider em cada uma das centenas de fontes.
    """
    monkeypatch.setenv("SCRAPING_API_HOSTS", "comix.to")
    monkeypatch.setenv("SCRAPERAPI_KEY", "K")
    assert scraping_api.deve_rotear("https://comix.to/x") is True

    for _ in range(scraping_api._LIMITE_FALHAS_SEGUIDAS):
        assert scraping_api.buscar(SessaoFake([RespFake(401)]), "https://comix.to/x") is None

    assert scraping_api.deve_rotear("https://comix.to/x") is False


def test_disjuntor_nao_desliga_antes_do_limite(monkeypatch):
    monkeypatch.setenv("SCRAPING_API_HOSTS", "comix.to")
    monkeypatch.setenv("SCRAPERAPI_KEY", "K")
    for _ in range(scraping_api._LIMITE_FALHAS_SEGUIDAS - 1):
        scraping_api.buscar(SessaoFake([RespFake(401)]), "https://comix.to/x")
    assert scraping_api.deve_rotear("https://comix.to/x") is True


def test_sucesso_zera_o_contador_do_disjuntor(monkeypatch):
    """Falha pontual num alvo não pode acumular até desligar o roteamento."""
    monkeypatch.setenv("SCRAPING_API_HOSTS", "comix.to")
    monkeypatch.setenv("SCRAPERAPI_KEY", "K")
    for _ in range(scraping_api._LIMITE_FALHAS_SEGUIDAS - 1):
        scraping_api.buscar(SessaoFake([RespFake(500)]), "https://comix.to/x")
    # Um sucesso no meio zera o contador...
    assert scraping_api.buscar(SessaoFake([RespFake(200)]), "https://comix.to/y") is not None
    # ...então mais uma falha ainda não atinge o limite.
    scraping_api.buscar(SessaoFake([RespFake(500)]), "https://comix.to/x")
    assert scraping_api.deve_rotear("https://comix.to/x") is True


def test_buscar_dobra_params_no_alvo(monkeypatch):
    monkeypatch.setenv("SCRAPERAPI_KEY", "K")
    sessao = SessaoFake([RespFake(200)])
    scraping_api.buscar(sessao, "https://comix.to/api/v1/manga", params={"page": 2, "limit": 100})
    assert sessao.chamadas[0]["params"]["url"] == "https://comix.to/api/v1/manga?page=2&limit=100"


# --- integração com common.http_get ------------------------------------------


def test_http_get_cai_pro_direto_quando_os_providers_morrem(monkeypatch):
    """
    O contrato que fecha o buraco do comix: roteamento ligado, todos os
    providers falhando, e mesmo assim `http_get` devolve a resposta do site
    pelo caminho direto — em vez do erro do provider.
    """
    import common

    monkeypatch.setenv("SCRAPING_API_HOSTS", "comix.to")
    monkeypatch.setenv("SCRAPERAPI_KEY", "K")

    direto = RespFake(200, "html-do-site")

    class SessaoDireta:
        def __init__(self):
            self.gets_diretos = []

        def get(self, url, params=None, headers=None, timeout=None, **kwargs):
            # Chamada ao provider (base da API) vs. chamada direta ao site.
            if url.startswith("https://api.scraperapi.com/"):
                return RespFake(401)
            self.gets_diretos.append(url)
            return direto

    sessao = SessaoDireta()
    monkeypatch.setattr(common, "_sessao_http", lambda: sessao)

    resp = common.http_get("https://comix.to/title/x")
    assert resp is direto
    assert sessao.gets_diretos == ["https://comix.to/title/x"]


def test_http_get_usa_o_provider_quando_ele_responde(monkeypatch):
    """Com provider saudável, nada de acesso direto: o roteamento segue valendo."""
    import common

    monkeypatch.setenv("SCRAPING_API_HOSTS", "comix.to")
    monkeypatch.setenv("SCRAPERAPI_KEY", "K")

    via_provider = RespFake(200, "html-do-provider")

    class SessaoDireta:
        def __init__(self):
            self.gets_diretos = []

        def get(self, url, params=None, headers=None, timeout=None, **kwargs):
            if url.startswith("https://api.scraperapi.com/"):
                return via_provider
            self.gets_diretos.append(url)
            return RespFake(200, "nao-deveria-chegar-aqui")

    sessao = SessaoDireta()
    monkeypatch.setattr(common, "_sessao_http", lambda: sessao)

    assert common.http_get("https://comix.to/title/x") is via_provider
    assert sessao.gets_diretos == []


# --- stand-by e registro de necessidade -------------------------------------


def test_standby_desliga_o_roteamento(monkeypatch):
    """Com host e chave configurados, o stand-by ainda assim manda tudo direto."""
    monkeypatch.setenv("SCRAPING_API_HOSTS", "comix.to")
    monkeypatch.setenv("SCRAPERAPI_KEY", "K")
    assert scraping_api.deve_rotear("https://comix.to/x") is True

    monkeypatch.setenv("SCRAPING_API_STANDBY", "true")
    assert scraping_api.deve_rotear("https://comix.to/x") is False


def test_registrar_necessidade_so_vale_pra_host_configurado(monkeypatch):
    """
    Bloqueio em domínio que nunca foi roteado não é problema de credencial —
    pedir renovação de chave nesse caso seria ruído.
    """
    monkeypatch.setenv("SCRAPING_API_HOSTS", "comix.to")
    scraping_api.registrar_necessidade("https://outro.site/x", "HTTP 403")
    assert scraping_api.necessidades() == {}

    scraping_api.registrar_necessidade("https://comix.to/title/x", "HTTP 403 (possível Cloudflare)")
    assert scraping_api.necessidades() == {"comix.to": "HTTP 403 (possível Cloudflare)"}


def test_necessidade_guarda_o_primeiro_diagnostico_por_host(monkeypatch):
    monkeypatch.setenv("SCRAPING_API_HOSTS", "comix.to")
    scraping_api.registrar_necessidade("https://comix.to/a", "primeiro")
    scraping_api.registrar_necessidade("https://comix.to/b", "segundo")
    assert scraping_api.necessidades() == {"comix.to": "primeiro"}


def test_necessidades_vazio_quando_nada_bloqueou(monkeypatch):
    monkeypatch.setenv("SCRAPING_API_HOSTS", "comix.to")
    assert scraping_api.necessidades() == {}


# --- limiar de "parou de achar capítulo" -------------------------------------


def test_taxa_sem_capitulo_acima_do_limiar_registra(monkeypatch):
    """O caso silencioso: o site responde 200 mas parou de entregar capítulo."""
    monkeypatch.setenv("SCRAPING_API_HOSTS", "comix.to")
    assert scraping_api.avaliar_taxa_sem_capitulo("comix.to", 273, 273) is True
    assert "273 de 273" in scraping_api.necessidades()["comix.to"]
    assert "100%" in scraping_api.necessidades()["comix.to"]


def test_taxa_sem_capitulo_na_linha_de_base_nao_registra(monkeypatch):
    """
    comix saudável fica em ~4,7% sem capítulo (obras ainda sem capítulo
    publicado). Isso não pode acender o alerta.
    """
    monkeypatch.setenv("SCRAPING_API_HOSTS", "comix.to")
    assert scraping_api.avaliar_taxa_sem_capitulo("comix.to", 430, 20) is False
    assert scraping_api.necessidades() == {}


def test_taxa_sem_capitulo_pega_quebra_parcial(monkeypatch):
    """Cloudflare barrando metade das requisições já é hora de renovar."""
    monkeypatch.setenv("SCRAPING_API_HOSTS", "comix.to")
    assert scraping_api.avaliar_taxa_sem_capitulo("comix.to", 200, 120) is True


def test_taxa_sem_capitulo_ignora_dominio_nao_configurado(monkeypatch):
    """
    31 dos 55 domínios do log real ficam em 100% sem capítulo de forma
    permanente (webtoons, manta, tappytoon...): o scraper nunca conseguiu ler
    esses sites. Alertar neles encheria o banner de ruído no primeiro dia.
    """
    monkeypatch.setenv("SCRAPING_API_HOSTS", "comix.to")
    assert scraping_api.avaliar_taxa_sem_capitulo("webtoons.com", 28, 28) is False
    assert scraping_api.necessidades() == {}


def test_taxa_sem_capitulo_exige_amostra_minima(monkeypatch):
    """Num domínio com 2 fontes, uma obra sem capítulo já daria 50%."""
    monkeypatch.setenv("SCRAPING_API_HOSTS", "comix.to")
    assert scraping_api.avaliar_taxa_sem_capitulo("comix.to", 2, 2) is False
    assert scraping_api.avaliar_taxa_sem_capitulo("comix.to", 9, 9) is False
    assert scraping_api.avaliar_taxa_sem_capitulo("comix.to", 10, 10) is True


def test_taxa_sem_capitulo_dominio_limpo_nao_registra(monkeypatch):
    monkeypatch.setenv("SCRAPING_API_HOSTS", "comix.to")
    assert scraping_api.avaliar_taxa_sem_capitulo("comix.to", 430, 0) is False
