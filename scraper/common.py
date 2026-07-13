"""Utilidades compartilhadas pelo scraper (stage 1: atualizar fontes, stage 2: descobrir fontes)."""

import os
import re
from pathlib import Path

from supabase import create_client

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

# Casa "chapter 123", "chapter-123.5", "ch. 12", "Ch12" etc, em href ou texto visível.
CHAPTER_PATTERN = re.compile(r"(?:chapter|chap|ch)[\s\-_.]*?(\d+(?:\.\d+)?)", re.IGNORECASE)


def carregar_env_local():
    """Suporte a scraper/.env pra rodar localmente; em CI as secrets já vêm como env vars."""
    env_path = Path(__file__).parent / ".env"
    if not env_path.exists():
        return
    for linha in env_path.read_text().splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        chave, _, valor = linha.partition("=")
        os.environ.setdefault(chave.strip(), valor.strip().strip('"').strip("'"))


def get_supabase():
    carregar_env_local()
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


def iniciar_run(supabase, tipo: str) -> str:
    """Registra o início de uma execução do scraper (tipo: 'capitulos' | 'fontes'). Retorna o id da run."""
    resp = supabase.table("scraper_runs").insert({"tipo": tipo, "status": "rodando"}).execute()
    return resp.data[0]["id"]


def finalizar_run(supabase, run_id: str, status: str, mensagem: str | None = None) -> None:
    """status: 'concluido' | 'erro'."""
    from datetime import datetime, timezone

    supabase.table("scraper_runs").update(
        {"status": status, "finalizado_em": datetime.now(timezone.utc).isoformat(), "mensagem": mensagem}
    ).eq("id", run_id).execute()


def extrair_maior_capitulo(html: str) -> float | None:
    """
    Extração genérica do maior número de capítulo encontrado no HTML (href + texto dos links).
    Heurística site-agnóstica: a maioria dos agregadores de manga/novel usa padrões
    "chapter-123" na URL ou "Chapter 123" no texto do link. Caso um site específico
    precise de um parser dedicado (estrutura muito diferente), adicione uma função
    `extrair_<site>` neste módulo e despache por `site` em update_fontes.py.
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    numeros = []
    for a in soup.find_all("a"):
        alvos = [a.get("href") or "", a.get_text() or ""]
        for texto in alvos:
            for m in CHAPTER_PATTERN.finditer(texto):
                try:
                    numeros.append(float(m.group(1)))
                except ValueError:
                    continue
    if not numeros:
        return None
    maior = max(numeros)
    return int(maior) if maior.is_integer() else maior
