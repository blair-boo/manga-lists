"""Regras puras do backup (retenção, quando gravar mensal/limpar imagens, trava
de segurança e plano incremental das imagens). Nenhum teste toca rede ou rclone."""

from datetime import date
from pathlib import Path

from backup_supabase import (
    caminho_local_seguro,
    chaves_a_apagar,
    deve_gravar_mensal,
    deve_limpar_imagens,
    limpeza_segura,
    montar_status,
    planejar_storage,
)


def test_retencao_mantem_as_4_mais_novas():
    chaves = ['2026-09-06', '2026-08-30', '2026-09-27', '2026-09-13', '2026-09-20']
    assert chaves_a_apagar(chaves) == ['2026-08-30']


def test_retencao_nao_apaga_com_4_ou_menos():
    assert chaves_a_apagar(['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27']) == []
    assert chaves_a_apagar([]) == []


def test_retencao_mensal_so_olha_as_proprias_chaves():
    semanais = ['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27', '2026-10-04']
    mensais = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']
    assert chaves_a_apagar(semanais) == ['2026-09-06']
    assert chaves_a_apagar(mensais) == ['2026-06']


def test_mensal_so_no_primeiro_domingo_do_mes():
    assert deve_gravar_mensal(date(2026, 10, 4))
    assert deve_gravar_mensal(date(2026, 10, 7))
    assert not deve_gravar_mensal(date(2026, 10, 11))
    assert not deve_gravar_mensal(date(2026, 10, 25))


def test_limpeza_de_imagens_so_em_janeiro_e_julho_no_comeco_do_mes():
    assert deve_limpar_imagens(date(2027, 1, 3))
    assert deve_limpar_imagens(date(2026, 7, 5))
    assert not deve_limpar_imagens(date(2027, 1, 10))
    assert not deve_limpar_imagens(date(2026, 10, 4))


def test_trava_recusa_listagem_vazia_ou_com_queda_grande():
    assert not limpeza_segura(0, 500)
    assert not limpeza_segura(0, 0)
    assert not limpeza_segura(200, 500)
    assert limpeza_segura(250, 500)
    assert limpeza_segura(480, 500)
    assert limpeza_segura(10, 5)


def test_plano_incremental_baixa_so_o_que_falta_ou_mudou_e_lista_orfaos():
    supabase = {'a.jpg': 10, 'b.jpg': 20, 'novo.jpg': 5}
    r2 = {'a.jpg': 10, 'b.jpg': 99, 'velho.jpg': 7}
    baixar, orfaos = planejar_storage(supabase, r2)
    assert baixar == ['b.jpg', 'novo.jpg']
    assert orfaos == ['velho.jpg']


def test_caminho_local_seguro_bloqueia_escape_da_pasta(tmp_path: Path):
    assert caminho_local_seguro(tmp_path, 'pasta/capa.jpg') == (tmp_path / 'pasta/capa.jpg').resolve()
    assert caminho_local_seguro(tmp_path, '../fora.txt') is None
    assert caminho_local_seguro(tmp_path, 'a/../../fora.txt') is None


def test_status_ordena_semanais_antes_dos_mensais_do_mais_novo_ao_mais_antigo():
    snaps = [
        {'tipo': 'monthly', 'nome': '2026-09', 'tamanho_bytes': 1, 'linhas': 1},
        {'tipo': 'weekly', 'nome': '2026-09-20', 'tamanho_bytes': 1, 'linhas': 1},
        {'tipo': 'monthly', 'nome': '2026-10', 'tamanho_bytes': 1, 'linhas': 1},
        {'tipo': 'weekly', 'nome': '2026-10-04', 'tamanho_bytes': 1, 'linhas': 1},
    ]
    status = montar_status(snaps, (1000, 7), 100, (900, 6))
    assert [(x['tipo'], x['nome']) for x in status['snapshots']] == [
        ('weekly', '2026-10-04'), ('weekly', '2026-09-20'), ('monthly', '2026-10'), ('monthly', '2026-09'),
    ]
    assert status['id'] == 1
    assert (status['tamanho_total_bytes'], status['tamanho_db_bytes']) == (1000, 100)
    assert (status['tamanho_imagens_bytes'], status['objetos_imagens']) == (900, 6)
