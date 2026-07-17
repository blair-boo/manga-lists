"""Testes de parse dos adaptadores, com fixtures sintéticos mínimos (ver
comentários nos arquivos de scraper/tests/fixtures/). Só exercitam parse():
nenhum teste toca rede, fetch ou Supabase."""

from pathlib import Path

import pytest

from adapter_base import RawContent, STATUS_INVALIDA, STATUS_OK
from adapters import CmsGenericoAdapter, EzmangaAdapter
from adapters_novos import MadaraAdapter

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
