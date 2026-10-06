"""Backup do Supabase para o Cloudflare R2 (rodado por .github/workflows/backup.yml).

Layout no bucket do R2:
  db/weekly/AAAA-MM-DD/<tabela>.json   4 mais novos (todo domingo)
  db/monthly/AAAA-MM/<tabela>.json     4 mais novos (primeiro domingo do mês)
  storage/<bucket>/<path>              espelho único das imagens/arquivos

O banco (pequeno) é exportado inteiro a cada execução. As imagens são
incrementais: só baixa do Supabase o que falta no R2 (ou mudou de tamanho), pra
não gastar o tráfego (egress) do Supabase toda semana. Em janeiro e julho
(primeiro domingo) também apaga do R2 o que já não existe no Supabase, com uma
trava de segurança contra listagens vazias/incompletas.

Falha alto de propósito: qualquer erro sai com código != 0, pra nunca tratar um
backup parcial como válido (e a poda de backups antigos só roda depois do envio).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path
from urllib.parse import quote

import requests

TABELAS: dict[str, str] = {
    'obras': 'id',
    'fontes': 'id',
    'listas': 'id',
    'reader_obras': 'id',
    'reader_fontes': 'id',
    'reader_capitulos': 'id',
    'conciliacao_blacklist': 'id',
    'conciliacao_pendentes': 'id',
    'configuracoes_scraper': 'chave',
    'dominios_bloqueados': 'id',
    'novelupdates_pendentes': 'id',
    'scraper_runs': 'id',
    'sites_suportados': 'id',
}
BUCKETS = ['capas', 'icons', 'imagens-importadas', 'reader']
MANTER = 4
PAGINA = 1000
TIMEOUT = 60


# --- Regras puras (testadas em tests/test_backup_supabase.py) ---------------


def chaves_a_apagar(chaves: list[str], manter: int = MANTER) -> list[str]:
    """Chaves além das `manter` mais novas. Nomes são datas ISO (AAAA-MM-DD ou
    AAAA-MM), então a ordem alfabética é a cronológica."""
    return sorted(chaves)[:-manter] if len(chaves) > manter else []


def deve_gravar_mensal(dia: date) -> bool:
    """Primeira execução de domingo do mês (dia <= 7): fechou 4 semanas."""
    return dia.day <= 7


def deve_limpar_imagens(dia: date) -> bool:
    """A cada 6 meses (janeiro e julho), no primeiro domingo."""
    return dia.month in (1, 7) and dia.day <= 7


def limpeza_segura(no_supabase: int, no_r2: int) -> bool:
    """Só apaga órfãos do R2 se a listagem do Supabase parece completa: nunca
    com 0 objetos e nunca se ela tem menos da metade do que o R2 já guarda
    (provável falha de listagem, que apagaria o backup inteiro)."""
    if no_supabase == 0:
        return False
    return no_supabase * 2 >= no_r2


def planejar_storage(supabase: dict[str, int], r2: dict[str, int]) -> tuple[list[str], list[str]]:
    """(a baixar, órfãos). A baixar: ausentes no R2 ou com tamanho diferente.
    Órfãos: estão no R2 e não existem mais no Supabase."""
    baixar = sorted(p for p, tam in supabase.items() if r2.get(p) != tam)
    orfaos = sorted(p for p in r2 if p not in supabase)
    return baixar, orfaos


def caminho_local_seguro(raiz: Path, relativo: str) -> Path | None:
    """Caminho dentro de `raiz`, ou None se o nome do objeto tentar escapar dela."""
    alvo = (raiz / relativo).resolve()
    return alvo if alvo.is_relative_to(raiz.resolve()) else None


# --- Supabase ----------------------------------------------------------------


def _sessao(chave: str) -> requests.Session:
    s = requests.Session()
    s.headers.update({'apikey': chave, 'Authorization': f'Bearer {chave}'})
    return s


def baixar_tabela(s: requests.Session, base: str, tabela: str, pk: str) -> list[dict]:
    linhas: list[dict] = []
    inicio = 0
    total: int | None = None
    while total is None or inicio < total:
        r = s.get(
            f'{base}/rest/v1/{tabela}',
            params={'select': '*', 'order': f'{pk}.asc'},
            headers={'Range-Unit': 'items', 'Range': f'{inicio}-{inicio + PAGINA - 1}', 'Prefer': 'count=exact'},
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        total = int(r.headers['Content-Range'].split('/')[1])
        pagina = r.json()
        if not pagina and inicio < total:
            raise RuntimeError(f'{tabela}: página vazia em {inicio}/{total}')
        linhas.extend(pagina)
        inicio += PAGINA
    if len(linhas) != total:
        raise RuntimeError(f'{tabela}: baixou {len(linhas)} de {total} linhas')
    return linhas


def listar_objetos(s: requests.Session, base: str, bucket: str, prefixo: str = '') -> dict[str, int]:
    """path -> tamanho, recursivo. Pastas aparecem sem `id` e são percorridas."""
    objetos: dict[str, int] = {}
    offset = 0
    while True:
        r = s.post(
            f'{base}/storage/v1/object/list/{bucket}',
            json={'prefix': prefixo, 'limit': PAGINA, 'offset': offset, 'sortBy': {'column': 'name', 'order': 'asc'}},
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        itens = r.json()
        for item in itens:
            caminho = f'{prefixo}{item["name"]}'
            if item.get('id') is None:
                objetos.update(listar_objetos(s, base, bucket, f'{caminho}/'))
            else:
                objetos[caminho] = int((item.get('metadata') or {}).get('size') or 0)
        if len(itens) < PAGINA:
            return objetos
        offset += PAGINA


def baixar_objeto(s: requests.Session, base: str, bucket: str, caminho: str, destino: Path) -> None:
    destino.parent.mkdir(parents=True, exist_ok=True)
    with s.get(f'{base}/storage/v1/object/authenticated/{bucket}/{quote(caminho)}', stream=True, timeout=TIMEOUT) as r:
        r.raise_for_status()
        with open(destino, 'wb') as f:
            for pedaco in r.iter_content(chunk_size=1 << 20):
                f.write(pedaco)


# --- rclone (configurado por variáveis RCLONE_CONFIG_R2_*, sem arquivo) ------


def rclone(*args: str) -> str:
    r = subprocess.run(['rclone', *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f'rclone {args[0]} falhou: {r.stderr.strip()[:500]}')
    return r.stdout


def listar_r2(prefixo: str) -> dict[str, int]:
    saida = rclone('lsjson', '-R', '--files-only', prefixo)
    return {i['Path']: int(i['Size']) for i in json.loads(saida or '[]')}


# --- Orquestração ------------------------------------------------------------


def exportar_banco(s: requests.Session, base: str, destino: Path) -> dict[str, int]:
    destino.mkdir(parents=True, exist_ok=True)
    contagens: dict[str, int] = {}
    for tabela, pk in TABELAS.items():
        linhas = baixar_tabela(s, base, tabela, pk)
        (destino / f'{tabela}.json').write_text(json.dumps(linhas, ensure_ascii=False, indent=1), encoding='utf-8')
        contagens[tabela] = len(linhas)
        print(f'  {tabela}: {len(linhas)} linhas')
    (destino / 'manifest.json').write_text(json.dumps({'gerado_em': date.today().isoformat(), 'linhas': contagens}, indent=1))
    return contagens


def enviar_banco(raiz_r2: str, origem: Path, hoje: date) -> None:
    rclone('copy', str(origem), f'{raiz_r2}/db/weekly/{hoje.isoformat()}')
    if deve_gravar_mensal(hoje):
        rclone('copy', str(origem), f'{raiz_r2}/db/monthly/{hoje:%Y-%m}')
    # Poda só DEPOIS de o envio ter dado certo; cada grupo só mexe nele mesmo.
    for grupo in ('weekly', 'monthly'):
        pastas = [p.rstrip('/') for p in rclone('lsf', '--dirs-only', f'{raiz_r2}/db/{grupo}').split()]
        for antiga in chaves_a_apagar(pastas):
            print(f'  poda: db/{grupo}/{antiga}')
            rclone('purge', f'{raiz_r2}/db/{grupo}/{antiga}')


def espelhar_imagens(s: requests.Session, base: str, raiz_r2: str, tmp: Path, hoje: date) -> None:
    for bucket in BUCKETS:
        print(f'bucket {bucket}')
        supabase = listar_objetos(s, base, bucket)
        r2 = listar_r2(f'{raiz_r2}/storage/{bucket}')
        baixar, orfaos = planejar_storage(supabase, r2)
        print(f'  supabase={len(supabase)} r2={len(r2)} a_enviar={len(baixar)} orfaos={len(orfaos)}')

        raiz_local = tmp / 'storage' / bucket
        for caminho in baixar:
            destino = caminho_local_seguro(raiz_local, caminho)
            if destino is None:
                print(f'  ignorado (caminho suspeito): {caminho}')
                continue
            baixar_objeto(s, base, bucket, caminho, destino)
        if baixar and raiz_local.exists():
            rclone('copy', str(raiz_local), f'{raiz_r2}/storage/{bucket}')

        if orfaos and deve_limpar_imagens(hoje):
            if limpeza_segura(len(supabase), len(r2)):
                lista = tmp / f'orfaos-{bucket}.txt'
                lista.write_text('\n'.join(orfaos), encoding='utf-8')
                rclone('delete', f'{raiz_r2}/storage/{bucket}', '--files-from', str(lista))
                print(f'  limpeza: {len(orfaos)} órfãos removidos')
            else:
                print('  limpeza ABORTADA pela trava de segurança (listagem do Supabase suspeita)')


def main() -> int:
    base = os.environ['SUPABASE_URL'].rstrip('/')
    s = _sessao(os.environ['SUPABASE_SERVICE_ROLE_KEY'])
    raiz_r2 = f'r2:{os.environ["R2_BUCKET"]}'
    hoje = date.today()

    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        print('Exportando banco')
        exportar_banco(s, base, tmp / 'db')
        print('Enviando banco')
        enviar_banco(raiz_r2, tmp / 'db', hoje)
        print('Espelhando imagens')
        espelhar_imagens(s, base, raiz_r2, tmp, hoje)
    print('Backup concluído')
    return 0


if __name__ == '__main__':
    sys.exit(main())
