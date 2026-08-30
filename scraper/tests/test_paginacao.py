"""
Testes de `common.buscar_todas`: a paginação que impede o corte silencioso do
PostgREST em 1000 linhas (db-max-rows).

Regressão real: `update_fontes.py` lia só 1000 das 1448 fontes aprovadas, e as
448 restantes — entre elas as do comix cadastradas/atualizadas pela tela de
importação — nunca chegavam a ser verificadas.
"""

import common


class QueryFake:
    """
    Dublê do query builder do supabase-py: só entende `.range(de, ate)` e
    `.execute()`, devolvendo a fatia correspondente de `linhas`.
    """

    def __init__(self, linhas, registro):
        self._linhas = linhas
        self._registro = registro
        self._de = None
        self._ate = None

    def range(self, de, ate):
        self._de, self._ate = de, ate
        return self

    def execute(self):
        self._registro.append((self._de, self._ate))
        # PostgREST: range é inclusivo nas duas pontas.
        return type("Resp", (), {"data": self._linhas[self._de : self._ate + 1]})()


def _fabrica(total, registro):
    linhas = [{"id": f"{i:05d}"} for i in range(total)]
    return lambda: QueryFake(linhas, registro)


def test_traz_tudo_quando_passa_de_uma_pagina():
    """1448 linhas com página de 1000: duas requisições, nada perdido."""
    registro = []
    linhas = common.buscar_todas(_fabrica(1448, registro), tamanho_pagina=1000)
    assert len(linhas) == 1448
    assert registro == [(0, 999), (1000, 1999)]
    # Sem duplicatas nem buracos.
    assert len({l["id"] for l in linhas}) == 1448


def test_uma_pagina_so_quando_cabe():
    registro = []
    linhas = common.buscar_todas(_fabrica(430, registro), tamanho_pagina=1000)
    assert len(linhas) == 430
    assert registro == [(0, 999)]


def test_multiplo_exato_do_tamanho_da_pagina():
    """
    2000 linhas em páginas de 1000: a segunda página vem cheia, então é
    preciso uma terceira requisição (vazia) pra saber que acabou. Parar em
    "veio cheia" perderia o resto quando o total não é múltiplo.
    """
    registro = []
    linhas = common.buscar_todas(_fabrica(2000, registro), tamanho_pagina=1000)
    assert len(linhas) == 2000
    assert registro == [(0, 999), (1000, 1999), (2000, 2999)]


def test_tabela_vazia():
    registro = []
    assert common.buscar_todas(_fabrica(0, registro), tamanho_pagina=1000) == []
    assert registro == [(0, 999)]


def test_query_e_reconstruida_a_cada_pagina():
    """
    O builder do supabase-py guarda estado entre execuções, então buscar_todas
    tem que chamar a fábrica uma vez por página em vez de reusar a query.
    """
    chamadas = []
    linhas = [{"id": f"{i:05d}"} for i in range(2500)]

    def fabrica():
        chamadas.append(1)
        return QueryFake(linhas, [])

    assert len(common.buscar_todas(fabrica, tamanho_pagina=1000)) == 2500
    assert len(chamadas) == 3
