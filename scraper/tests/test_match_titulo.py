"""Testes dos limiares de match de título (match_titulo.decidir_status)."""

from match_titulo import decidir_status, melhor_match

LIMIARES = {"limiar_auto_aprovacao": 0.95, "limiar_minimo_pendencia": 0.70}


def test_abaixo_do_minimo_descarta():
    assert decidir_status(0.0, LIMIARES) is None
    assert decidir_status(0.69, LIMIARES) is None


def test_entre_minimo_e_auto_vai_pra_fila():
    assert decidir_status(0.70, LIMIARES) == "pendente"  # limite inferior inclusivo
    assert decidir_status(0.85, LIMIARES) == "pendente"
    assert decidir_status(0.9499, LIMIARES) == "pendente"


def test_no_auto_ou_acima_aprova():
    assert decidir_status(0.95, LIMIARES) == "aprovado"  # limite inclusivo
    assert decidir_status(1.0, LIMIARES) == "aprovado"


def test_melhor_match_ignora_ordem_das_palavras():
    obra = {"titulo": "The Forgotten Field", "titulos_alternativos": None}
    assert melhor_match("Forgotten Field, The", obra) > 0.9


def test_melhor_match_considera_titulos_alternativos():
    obra = {"titulo": "Título Nada a Ver", "titulos_alternativos": ["Solo Leveling"]}
    assert melhor_match("Solo Leveling", obra) == 1.0


def test_melhor_match_sem_titulos_retorna_zero():
    assert melhor_match("Qualquer", {"titulo": "", "titulos_alternativos": None}) == 0.0
