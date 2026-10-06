from discover_fontes import (
    dominio_em,
    montar_queries_web,
    parse_modo_web,
    parse_tipos,
)


def test_parse_tipos():
    assert parse_tipos("manga") == {"manga"}
    assert parse_tipos("novel") == {"novel"}
    assert parse_tipos("manga,novel") is None
    assert parse_tipos("") is None
    assert parse_tipos(None) is None
    assert parse_tipos("lixo") is None


def test_parse_modo_web():
    assert parse_modo_web("somente") == "somente"
    assert parse_modo_web(" Excluir ") == "excluir"
    assert parse_modo_web("") is None
    assert parse_modo_web("outro") is None


def test_dominio_em_aceita_subdominio():
    assert dominio_em("a.com", {"a.com"})
    assert dominio_em("m.a.com", {"a.com"})
    assert not dominio_em("xa.com", {"a.com"})


def test_queries_geral_usa_novel_para_novels():
    assert montar_queries_web({"titulo": "X", "tipo": "Novel"}, None, set()) == ["X novel read online"]
    assert montar_queries_web({"titulo": "X", "tipo": "Manhwa"}, "excluir", {"a.com"}) == ["X manga read online"]


def test_queries_somente_em_lotes_de_site():
    dominios = {f"d{i}.com" for i in range(7)}
    qs = montar_queries_web({"titulo": "X", "tipo": "Manga"}, "somente", dominios)
    assert len(qs) == 2
    assert qs[0].count("site:") == 5 and qs[1].count("site:") == 2
