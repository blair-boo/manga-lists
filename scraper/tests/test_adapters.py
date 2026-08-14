"""Testes de parse dos adaptadores, com fixtures sintéticos mínimos (ver
comentários nos arquivos de scraper/tests/fixtures/). Só exercitam parse():
nenhum teste toca rede, fetch ou Supabase."""

import json
from pathlib import Path

import pytest

from adapter_base import (
    CapituloDetectado,
    RawContent,
    STATUS_BLOQUEADO,
    STATUS_INVALIDA,
    STATUS_OK,
    STATUS_VAZIA,
    desempatar_chaves,
)
from adapters import CmsGenericoAdapter, EzmangaAdapter
from adapters_novos import (
    ComixAdapter,
    MadaraAdapter,
    MagustoonAdapter,
    ReadhiveAdapter,
    SakurazeAdapter,
    _desembrulhar_resultado as comix_desembrulhar,
    _extrair_json as comix_extrair_json,
    _order as comix_order,
    _pares_titulo_url as comix_pares,
    _titulos_do_item as comix_titulos,
)

FIXTURES = Path(__file__).parent / "fixtures"


def fixture(nome: str) -> str:
    return (FIXTURES / nome).read_text(encoding="utf-8")


# --- CmsGenericoAdapter (nyxscans, payload RSC do Next.js) -------------------


def test_cms_generico_parse_ok():
    raw = RawContent("ok", "https://nyxscans.com/series/blade-of-dawn", text=fixture("nyxscans_series.html"))
    resultado = CmsGenericoAdapter().parse(raw)
    assert resultado.status == STATUS_OK
    # 99 é DRAFT (não conta); o maior PUBLIC é 12.5.
    assert resultado.ultimo_capitulo == 12.5


def test_cms_generico_html_fora_do_formato_nao_levanta():
    raw = RawContent("ok", "https://nyxscans.com/series/x", text="<html><body>sem payload RSC aqui</body></html>")
    resultado = CmsGenericoAdapter().parse(raw)
    assert resultado.status == STATUS_INVALIDA


# --- EzmangaAdapter (Angular ng-state) ---------------------------------------


def test_ezmanga_parse_ok():
    raw = RawContent("ok", "https://ezmanga.org/series/blade-of-dawn", text=fixture("ezmanga_series.html"))
    resultado = EzmangaAdapter().parse(raw)
    assert resultado.status == STATUS_OK
    # 43 é SCHEDULED (não conta); o maior PUBLIC é 42, normalizado pra int.
    assert resultado.ultimo_capitulo == 42
    assert isinstance(resultado.ultimo_capitulo, int)
    assert resultado.titulo_site == "Blade of Dawn"
    assert resultado.link_capitulo == "https://ezmanga.org/series/blade-of-dawn/chapter-42"


@pytest.mark.parametrize(
    "html",
    [
        "<html><body>sem ng-state</body></html>",
        '<html><body><script id="ng-state" type="application/json">{isso não é json}</script></body></html>',
        '<html><body><script id="ng-state" type="application/json">{"estado": {"sem": "capitulos"}}</script></body></html>',
    ],
)
def test_ezmanga_html_fora_do_formato_nao_levanta(html):
    raw = RawContent("ok", "https://ezmanga.org/series/x", text=html)
    resultado = EzmangaAdapter().parse(raw)
    assert resultado.status == STATUS_INVALIDA


# --- MadaraAdapter (resposta do ajax/chapters/) ------------------------------


def test_madara_parse_ok():
    raw = RawContent(
        "ok",
        "https://example.com/manga/blade-of-dawn/ajax/chapters/?t=1",
        text=fixture("madara_ajax_chapters.html"),
    )
    resultado = MadaraAdapter().parse(raw)
    assert resultado.status == STATUS_OK
    # 101 > 100.5 > 9 (comparação numérica, não lexicográfica), normalizado pra int.
    assert resultado.ultimo_capitulo == 101
    assert isinstance(resultado.ultimo_capitulo, int)
    assert resultado.link_capitulo == "https://example.com/manga/blade-of-dawn/chapter-101/"


def test_madara_html_fora_do_formato_nao_levanta():
    raw = RawContent("ok", "https://example.com/manga/x/ajax/chapters/?t=1", text="<div>nada de capítulos</div>")
    resultado = MadaraAdapter().parse(raw)
    assert resultado.status == STATUS_INVALIDA


# --- MagustoonAdapter (Astro, links /series/<slug>/chapter-<N>) --------------


def test_magustoon_parse_ok():
    raw = RawContent(
        "ok", "https://magustoon.org/series/blade-of-dawn", text=fixture("magustoon_series.html")
    )
    resultado = MagustoonAdapter().parse(raw)
    assert resultado.status == STATUS_OK
    # 12.5 (decimal, fora de ordem no HTML) é o maior do próprio slug; a série
    # recomendada com chapter-999 não conta (escopo por slug).
    assert resultado.ultimo_capitulo == 12.5
    assert resultado.link_capitulo == "https://magustoon.org/series/blade-of-dawn/chapter-12.5"


def test_magustoon_normaliza_url_de_capitulo_para_overview():
    adapter = MagustoonAdapter()
    assert (
        adapter._url_overview("https://magustoon.org/series/blade-of-dawn/chapter-12.5")
        == "https://magustoon.org/series/blade-of-dawn"
    )


def test_magustoon_sem_links_do_slug_nao_levanta():
    # Página só com capítulos de OUTRA série → estrutura vazia pro slug pedido.
    raw = RawContent(
        "ok",
        "https://magustoon.org/series/blade-of-dawn",
        text='<a href="/series/outra-serie/chapter-999">x</a>',
    )
    resultado = MagustoonAdapter().parse(raw)
    assert resultado.status == STATUS_VAZIA


# --- ComixAdapter (React Query initial-data) ---------------------------------


def _comix_html(detalhe: dict | None, hid: str = "l78rz", com_chave_groups: bool = True) -> str:
    """HTML mínimo com o bloco #initial-data, pro teste montar cenários sem
    depender do fixture completo (mesmo padrão dos outros adaptadores)."""
    queries = {}
    if detalhe is not None:
        chave = json.dumps(["manga", "detail", hid], separators=(",", ":"))
        queries[chave] = detalhe
    if com_chave_groups:
        chave_groups = json.dumps(["manga", "groups", hid], separators=(",", ":"))
        queries[chave_groups] = {}
    blob = {"page": "manga", "queries": queries, "manga": {"hid": hid}}
    blob_json = json.dumps(blob, separators=(",", ":"))
    return f'<html><body><script type="application/json" id="initial-data">{blob_json}</script></body></html>'


def test_comix_parse_ok():
    raw = RawContent(
        "ok",
        "https://comix.to/title/l78rz-marchioness-maron",
        text=fixture("comix_title.html"),
    )
    r = ComixAdapter().parse(raw)
    assert r.status == STATUS_OK
    assert r.ultimo_capitulo == 48
    assert isinstance(r.ultimo_capitulo, int)
    assert r.titulo_site == "Marchioness Maron"
    assert r.tipo_detectado == "manga"
    assert r.status_publicacao_detectado == "Ongoing"
    assert r.link_capitulo == (
        "https://comix.to/title/l78rz-marchioness-maron/11128392-chapter-48"
    )


@pytest.mark.parametrize(
    "status_comix,esperado",
    [
        ("releasing", "Ongoing"),
        ("finished", "Completed"),
        ("on_hiatus", "Hiatus"),
        ("discontinued", "Canceled"),
        ("not_yet_released", None),  # sem correspondente no enum do app, ver _COMIX_STATUS_MAP
        ("algum_status_novo_desconhecido", None),
    ],
)
def test_comix_status_publicacao_mapeado(status_comix, esperado):
    detalhe = {
        "title": "Status Teste",
        "type": "manga",
        "status": status_comix,
        "hasChapters": True,
        "latestChapter": 1,
        "latestChapterUrl": "/title/l78rz-status-teste/1-chapter-1",
    }
    raw = RawContent("ok", "https://comix.to/title/l78rz-status-teste", text=_comix_html(detalhe))
    r = ComixAdapter().parse(raw)
    assert r.status_publicacao_detectado == esperado


def test_comix_status_publicacao_tambem_em_obra_sem_capitulos():
    # hasChapters=False cai em STATUS_VAZIA, mas o status de publicação (aqui,
    # ainda não lançado) não depende de ter capítulo achado.
    detalhe = {"title": "Ainda Sem Capítulos", "type": "manga", "status": "not_yet_released", "hasChapters": False}
    raw = RawContent("ok", "https://comix.to/title/l78rz-sem-capitulos", text=_comix_html(detalhe))
    r = ComixAdapter().parse(raw)
    assert r.status == STATUS_VAZIA
    assert r.status_publicacao_detectado is None

    detalhe2 = {"title": "Hiato Sem Capítulos", "type": "manga", "status": "on_hiatus", "hasChapters": False}
    raw2 = RawContent("ok", "https://comix.to/title/l78rz-hiato", text=_comix_html(detalhe2))
    r2 = ComixAdapter().parse(raw2)
    assert r2.status == STATUS_VAZIA
    assert r2.status_publicacao_detectado == "Hiatus"


def test_comix_capitulo_decimal_vira_float():
    detalhe = {
        "title": "Some Title",
        "type": "manga",
        "hasChapters": True,
        "latestChapter": 48.5,
        "latestChapterUrl": "/title/l78rz-some-title/1-chapter-48-5",
    }
    raw = RawContent(
        "ok", "https://comix.to/title/l78rz-some-title", text=_comix_html(detalhe)
    )
    r = ComixAdapter().parse(raw)
    assert r.status == STATUS_OK
    assert r.ultimo_capitulo == 48.5
    assert isinstance(r.ultimo_capitulo, float)


def test_comix_hasChapters_false_vazia_mas_preenche_titulo():
    detalhe = {"title": "Sem Capítulos Ainda", "type": "manga", "hasChapters": False}
    raw = RawContent(
        "ok", "https://comix.to/title/l78rz-sem-capitulos", text=_comix_html(detalhe)
    )
    r = ComixAdapter().parse(raw)
    assert r.status == STATUS_VAZIA
    assert r.titulo_site == "Sem Capítulos Ainda"


def test_comix_latestChapter_zero_vazia():
    detalhe = {
        "title": "Zero",
        "type": "manga",
        "hasChapters": True,
        "latestChapter": 0,
        "latestChapterUrl": "/title/l78rz-zero/1-chapter-0",
    }
    raw = RawContent("ok", "https://comix.to/title/l78rz-zero", text=_comix_html(detalhe))
    r = ComixAdapter().parse(raw)
    assert r.status == STATUS_VAZIA


def test_comix_sem_bloco_initial_data_nao_levanta():
    raw = RawContent("ok", "https://comix.to/title/l78rz-x", text="<html><body>nada aqui</body></html>")
    r = ComixAdapter().parse(raw)
    assert r.status == STATUS_INVALIDA


def test_comix_blob_sem_chave_detail_invalida():
    # ex.: página de browse, cujo blob não traz nenhuma chave ["manga","detail",...].
    blob = {"page": "browse", "queries": {'["manga","list"]': {"items": []}}}
    html = (
        '<html><body><script type="application/json" id="initial-data">'
        + json.dumps(blob, separators=(",", ":"))
        + "</script></body></html>"
    )
    raw = RawContent("ok", "https://comix.to/browse?types=manga", text=html)
    r = ComixAdapter().parse(raw)
    assert r.status == STATUS_INVALIDA


def test_comix_fallback_estrutural_sem_hid_na_url():
    # URL sem hid reconhecível, mas o blob tem a chave ["manga","detail",...]:
    # a varredura estrutural ainda encontra o registro.
    detalhe = {
        "title": "Achado Sem Hid",
        "type": "manhua",
        "hasChapters": True,
        "latestChapter": 3,
        "latestChapterUrl": "/title/xyz-achado/1-chapter-3",
    }
    raw = RawContent("ok", "https://comix.to/algo", text=_comix_html(detalhe, hid="xyz"))
    r = ComixAdapter().parse(raw)
    assert r.status == STATUS_OK
    assert r.titulo_site == "Achado Sem Hid"


def test_comix_acesso_bloqueado():
    raw = RawContent("acesso_bloqueado", "https://comix.to/title/l78rz-x", diagnostico="HTTP 403 (possível Cloudflare)")
    r = ComixAdapter().parse(raw)
    assert r.status == STATUS_BLOQUEADO


def test_comix_hid_da_url():
    adapter = ComixAdapter()
    assert adapter._hid_da_url("https://comix.to/title/l78rz-marchioness-maron") == "l78rz"
    assert adapter._hid_da_url("https://comix.to/browse?types=manga") is None


@pytest.mark.parametrize(
    "slug,esperado",
    [
        ("/title/l78rz-marchioness-maron", "https://comix.to/title/l78rz-marchioness-maron"),
        ("title/l78rz-marchioness-maron", "https://comix.to/title/l78rz-marchioness-maron"),
    ],
)
def test_comix_url_da_fonte(slug, esperado):
    adapter = ComixAdapter()
    assert adapter.url_da_fonte("https://comix.to/", slug) == esperado


def test_comix_extrair_json_cru():
    assert comix_extrair_json('{"items": [1, 2], "meta": {}}') == {"items": [1, 2], "meta": {}}


def test_comix_extrair_json_embrulhado_em_html():
    # Como o provider devolve ao renderizar (render=true) um endpoint JSON: o
    # navegador embrulha num <pre>, com <style>/<script> (que têm chaves) em volta.
    html = (
        "<html><head><style>body{margin:0}</style>"
        '<script>var x={a:1}</script></head><body>'
        '<pre>{"items":[{"title":"X","url":"/title/x"}],"meta":{"hasNext":false}}</pre>'
        "</body></html>"
    )
    dados = comix_extrair_json(html)
    assert dados == {"items": [{"title": "X", "url": "/title/x"}], "meta": {"hasNext": False}}


def test_comix_extrair_json_lixo_vira_none():
    assert comix_extrair_json("<html><body>Just a moment…</body></html>") is None
    assert comix_extrair_json("") is None


def test_comix_desembrulha_status_result():
    # A API responde {"status":"ok","result":{...}}; desembrulha pra .result.
    envelope = {"status": "ok", "result": {"items": [1], "meta": {"hasNext": True}}}
    assert comix_desembrulhar(envelope) == {"items": [1], "meta": {"hasNext": True}}
    # Sem envelope, passa direto.
    assert comix_desembrulhar({"items": [2]}) == {"items": [2]}


def test_comix_titulos_inclui_alternativos():
    # Casa por título principal E alternativos (pedido da dona).
    item = {"title": "Marchioness Maron", "altTitles": ["마론 후작부인", "Lady Maron"], "url": "/title/x"}
    assert comix_titulos(item) == ["Marchioness Maron", "마론 후작부인", "Lady Maron"]


def test_comix_titulos_altTitles_como_objetos():
    item = {"title": "A", "altTitles": [{"title": "B"}, {"name": "C"}, {"outro": "z"}]}
    assert comix_titulos(item) == ["A", "B", "C"]


def test_comix_titulos_sem_alternativos():
    assert comix_titulos({"title": "Só principal"}) == ["Só principal"]
    assert comix_titulos({"title": "X", "altTitles": None}) == ["X"]


def test_comix_pares_expande_um_par_por_titulo():
    itens = [
        {"title": "Alfa", "altTitles": ["Alpha"], "url": "/title/a"},
        {"title": "Beta", "url": "/title/b"},
        {"title": "Sem url", "altTitles": ["x"]},  # sem url -> ignorado
    ]
    assert comix_pares(itens) == [
        ("Alfa", "/title/a"),
        ("Alpha", "/title/a"),
        ("Beta", "/title/b"),
    ]


def test_comix_order_notacao_de_colchetes():
    # Confirmado lendo o bundle real do app + o fonte do Axios instalado
    # (toFormData.renderKey): sem paramsSerializer custom, objeto aninhado em
    # `params` vira notação de colchetes, não JSON.stringify (ver docstring
    # de `_order` em adapters_novos.py).
    assert comix_order({"chapter_updated_at": "desc"}) == {"order[chapter_updated_at]": "desc"}


# --- MadaraAdapter.listar_capitulos (aba Reader) -----------------------------
#
# Diferente do parse() acima, que só devolve o último capítulo: aqui a lista
# inteira importa, e os bloqueados — que o parse() ignora de propósito, porque
# vêm com href="#" — são justamente o caso que interessa.


@pytest.fixture
def capitulos_madara():
    raw = RawContent("ok", "https://example.com/novel/blade-of-dawn/ajax/chapters/", text=fixture("madara_ajax_reader.html"))
    caps = MadaraAdapter().listar_capitulos(raw)
    assert caps is not None
    return caps


def test_madara_lista_todos_os_capitulos(capitulos_madara):
    # 6 <li> no fixture, nenhum descartado (nem os bloqueados sem URL).
    assert len(capitulos_madara) == 6


def test_madara_ordena_do_comeco_da_obra_pro_fim(capitulos_madara):
    # O tema serve do mais recente pro mais antigo; a UI quer o contrário.
    assert capitulos_madara[0].numero_texto == "Chapter 1"
    assert capitulos_madara[-1].numero_texto.startswith("Chapter 12.2")
    ordens = [c.ordem for c in capitulos_madara]
    assert ordens == sorted(ordens)


def test_madara_extrai_paywall_com_data_de_liberacao(capitulos_madara):
    bloqueados = [c for c in capitulos_madara if c.bloqueado]
    assert len(bloqueados) == 2
    # A data vem do <span class="soon_free">, nao do chapter-release-date
    # (que e a data de PUBLICACAO — 'Mar 11, 2026' no fixture).
    assert {c.disponivel_em for c in bloqueados} == {"2026-08-14", "2026-08-15"}
    # Bloqueado nao tem URL: e por isso que a chave nao pode ser a URL.
    assert all(c.url is None for c in bloqueados)
    # ...mas tem id proprio, que ajuda a casar/depurar.
    assert {c.id_externo for c in bloqueados} == {"14123", "14124"}


def test_madara_limpa_o_rotulo_do_capitulo(capitulos_madara):
    ultimo = capitulos_madara[-1]
    # O <i class="fas fa-lock"> dentro da ancora vira espaco e some. Ja o
    # sufixo " - END" FICA: numero_texto e o rotulo cru do site, e "END" e
    # informacao real (a obra terminou) que a lista de capitulos vai mostrar.
    assert "lock" not in ultimo.numero_texto
    assert "<" not in ultimo.numero_texto
    assert ultimo.numero_texto == "Chapter 12.2 - END"
    # O que precisa ser limpo e a IDENTIDADE, e ela sai do numero, nao do
    # rotulo — entao "- END" nao contamina a chave nem quebra a idempotencia.
    assert ultimo.numero == 12.2
    assert ultimo.chave == "12.2"


def test_madara_side_story_nao_colide_com_capitulo_de_mesmo_numero(capitulos_madara):
    ss = [c for c in capitulos_madara if c.side_story]
    assert len(ss) == 1
    assert ss[0].chave == "ss-1"
    cap1 = [c for c in capitulos_madara if c.numero_texto == "Chapter 1"]
    assert cap1[0].chave == "1"


def test_madara_desempata_rotulos_repetidos_pela_url(capitulos_madara):
    # Caso real: dois "Chapter 11.1" em URLs diferentes (o `_1` e o WordPress
    # desempatando slug numa republicacao). Sem desempate, a segunda linha
    # bateria na constraint unique (reader_obra_id, chave).
    repetidos = [c for c in capitulos_madara if c.numero_texto == "Chapter 11.1"]
    assert len(repetidos) == 2
    chaves = {c.chave for c in repetidos}
    assert len(chaves) == 2
    # Quem tem a URL "limpa" fica com a chave limpa — a ordem do desempate vem
    # da URL, nao da posicao na lista, pra que uma republicacao futura nao
    # renomeie a chave do capitulo original.
    assert "11.1" in chaves


def test_madara_nenhuma_chave_duplicada(capitulos_madara):
    chaves = [c.chave for c in capitulos_madara]
    assert len(chaves) == len(set(chaves))


def test_madara_listar_capitulos_devolve_none_sem_conteudo():
    assert MadaraAdapter().listar_capitulos(RawContent("erro", "https://x/", text=None)) is None
    assert MadaraAdapter().listar_capitulos(RawContent("ok", "https://x/", text="<html></html>")) is None


# --- listar_capitulos dos demais adaptadores (aba Reader) --------------------


def test_cms_generico_lista_capitulos_com_bloqueio():
    raw = RawContent("ok", "https://nyxscans.com/series/blade-of-dawn", text=fixture("nyxscans_reader.html"))
    caps = CmsGenericoAdapter().listar_capitulos(raw)
    assert caps is not None
    assert [c.chave for c in caps] == ["1", "2.5", "3", "99"]

    # O bloqueio vem de isAccessible/isLocked, NAO de chapterStatus: o cap. 3
    # esta 'PUBLIC' e mesmo assim travado por moedas.
    travado = next(c for c in caps if c.chave == "3")
    assert travado.bloqueado is True
    assert travado.url is None
    # isTimeLocked=false: e pago, nao cai sozinho — entao nao inventamos data.
    assert travado.disponivel_em is None

    livre = next(c for c in caps if c.chave == "1")
    assert livre.bloqueado is False
    assert livre.url == "https://nyxscans.com/series/blade-of-dawn/chapter-1"


def test_cms_generico_ordena_por_numero_e_nao_duplica():
    raw = RawContent("ok", "https://nyxscans.com/series/blade-of-dawn", text=fixture("nyxscans_reader.html"))
    caps = CmsGenericoAdapter().listar_capitulos(raw)
    assert [c.ordem for c in caps] == [1.0, 2.0, 3.0, 4.0]
    assert len({c.chave for c in caps}) == len(caps)


def test_sakuraze_lista_capitulos_com_data_de_liberacao():
    raw = RawContent("ok", "https://sakuraze.vercel.app/novel/blade-of-dawn", text=fixture("sakuraze_reader.json"))
    caps = SakurazeAdapter().listar_capitulos(raw)
    assert caps is not None
    assert len(caps) == 4

    # is_premium marca o bloqueio e scheduled_free_at diz quando cai — o
    # paywall mais completo dos tres sites (o nyxscans nao expoe data).
    travado = next(c for c in caps if c.bloqueado)
    assert travado.chave == "4"
    assert travado.disponivel_em == "2026-09-03"
    assert travado.url is None

    # Titulo vazio no banco cai pro rotulo derivado do numero.
    assert next(c for c in caps if c.chave == "1").numero_texto == "Chapter 1.0"


def test_sakuraze_side_story_sai_do_eixo_normal():
    raw = RawContent("ok", "https://sakuraze.vercel.app/novel/blade-of-dawn", text=fixture("sakuraze_reader.json"))
    caps = SakurazeAdapter().listar_capitulos(raw)
    ss = [c for c in caps if c.side_story]
    assert len(ss) == 1
    assert ss[0].chave == "ss-3"


def test_readhive_lista_capitulos_e_ignora_outras_series():
    raw = RawContent("ok", "https://readhive.org/series/1234", text=fixture("readhive_reader.html"))
    caps = ReadhiveAdapter().listar_capitulos(raw)
    assert caps is not None
    # O /series/9999/42 (recomendacao de outra serie) nao pode entrar.
    assert [c.chave for c in caps] == ["1", "2", "5"]
    assert all(c.url.startswith("https://readhive.org/series/1234/") for c in caps)


def test_readhive_numero_vem_da_url_nao_do_rotulo_sujo():
    # O texto da ancora e "10 Chapter 5 in 2 years" — o 10 (likes) nao pode
    # virar o numero do capitulo.
    raw = RawContent("ok", "https://readhive.org/series/1234", text=fixture("readhive_reader.html"))
    caps = ReadhiveAdapter().listar_capitulos(raw)
    ultimo = caps[-1]
    assert ultimo.numero == 5.0
    assert ultimo.numero_texto == "Chapter 5"


def test_readhive_ordem_e_sequencial_apesar_dos_buracos():
    raw = RawContent("ok", "https://readhive.org/series/1234", text=fixture("readhive_reader.html"))
    caps = ReadhiveAdapter().listar_capitulos(raw)
    assert [c.ordem for c in caps] == [1.0, 2.0, 3.0]
    assert [c.numero for c in caps] == [1.0, 2.0, 5.0]


def test_readhive_sem_paywall_nenhum_capitulo_bloqueado():
    raw = RawContent("ok", "https://readhive.org/series/1234", text=fixture("readhive_reader.html"))
    caps = ReadhiveAdapter().listar_capitulos(raw)
    assert all(not c.bloqueado for c in caps)


def test_desempate_de_chave_vale_pra_todos_os_adaptadores():
    """
    Regressao real: o desempate nasceu dentro do MadaraAdapter, e a varredura
    de producao falhou numa serie do nyxscans com dois "Chapter 130" (ids 16748
    e 16750) — a obra inteira ficou sem capitulos por violar a constraint
    unique (reader_obra_id, chave). A regra vale pra qualquer site, entao mora
    em adapter_base e e aplicada pelos quatro adaptadores.
    """
    caps = [
        CapituloDetectado(chave="130", numero=130.0, numero_texto="Chapter 130", id_externo="16750"),
        CapituloDetectado(chave="130", numero=130.0, numero_texto="Chapter 130", id_externo="16748"),
        CapituloDetectado(chave="131", numero=131.0, numero_texto="Chapter 131", id_externo="16751"),
    ]
    desempatar_chaves(caps)
    assert len({c.chave for c in caps}) == 3
    # O menor discriminador mantem a chave limpa, pra que uma republicacao
    # futura nao renomeie a chave do capitulo original.
    assert next(c for c in caps if c.id_externo == "16748").chave == "130"
    assert next(c for c in caps if c.id_externo == "16750").chave == "130-16750"
    assert next(c for c in caps if c.id_externo == "16751").chave == "131"


def test_desempate_usa_url_quando_nao_ha_id_do_site():
    # Caso do bellerepository: dois "Chapter 133.1" livres, sem id proprio.
    caps = [
        CapituloDetectado(chave="133.1", numero=133.1, url="https://x/novel/y/chapter-133-1_1/"),
        CapituloDetectado(chave="133.1", numero=133.1, url="https://x/novel/y/chapter-133-1/"),
    ]
    desempatar_chaves(caps)
    assert {c.chave for c in caps} == {"133.1", "133.1-chapter-133-1_1"}


def test_desempate_nao_mexe_em_chave_unica():
    caps = [CapituloDetectado(chave="1", numero=1.0), CapituloDetectado(chave="2", numero=2.0)]
    desempatar_chaves(caps)
    assert [c.chave for c in caps] == ["1", "2"]
