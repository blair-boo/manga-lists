"""Utilidades compartilhadas pelo scraper (stage 1: atualizar fontes, stage 2: descobrir fontes)."""

import json
import os
import re
from pathlib import Path
from urllib.parse import urlparse

import requests
from supabase import create_client

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

TIMEOUT = 25

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
    `extrair_<site>` neste módulo e despache por `site`/host em update_fontes.py.
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


# ---------------------------------------------------------------------------
# nyxscans.com — parser dedicado (não precisa de Playwright)
#
# O site é um Next.js (App Router / RSC). A página de cada obra
# (https://nyxscans.com/series/{slug}) já traz a lista completa de capítulos
# embutida no HTML, dentro do payload RSC (`self.__next_f.push([1,"..."])`),
# com aspas JSON escapadas (`\"chapters\":[...]`). Uma única requisição HTTP
# simples por obra basta — não é preciso renderizar JS nem chamar a API.
# Investigação documentada no handout do nyxscans.
# ---------------------------------------------------------------------------


def eh_nyxscans(url: str) -> bool:
    try:
        return "nyxscans.com" in (urlparse(url).hostname or "")
    except ValueError:
        return False


def slug_de_url_nyxscans(url: str) -> str | None:
    """Extrai o slug de uma URL tipo https://nyxscans.com/series/{slug}."""
    partes = [p for p in urlparse(url).path.split("/") if p]
    if "series" in partes:
        i = partes.index("series")
        if i + 1 < len(partes):
            return partes[i + 1]
    return partes[-1] if partes else None


def _extrair_array_balanceado(html: str, marcador: str) -> str | None:
    """
    Extrai um array JSON (com objetos aninhados) que começa em `marcador` dentro
    do HTML escapado do RSC. Usa contagem de colchetes balanceados em vez de regex
    guloso, porque o array tem `[`/`]` e `{`/`}` aninhados que quebram regex simples.
    Retorna o trecho bruto (ainda com escapes `\"`), ou None se não achar.
    """
    idx = html.find(marcador)
    if idx == -1:
        return None
    start = idx + len(marcador) - 1  # posição do '['
    depth, i = 0, start
    while i < len(html):
        c = html[i]
        if c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                return html[start : i + 1]
        i += 1
    return None


def buscar_capitulos_nyxscans(slug: str) -> list[dict] | None:
    """
    Baixa a página da obra e extrai a lista completa de capítulos embutida no
    HTML (payload RSC do Next.js). Cada item tem ao menos `number` e
    `chapterStatus` ('PUBLIC' | outros). Retorna None se não achar.
    """
    resp = requests.get(f"https://nyxscans.com/series/{slug}", headers=HEADERS, timeout=TIMEOUT)
    resp.raise_for_status()
    bruto = _extrair_array_balanceado(resp.text, r'\"chapters\":[')
    if bruto is None:
        return None
    try:
        # o trecho vem com aspas JSON escapadas (\") — desescapa antes de parsear
        desescapado = bruto.encode("utf-8", "backslashreplace").decode("unicode_escape")
        return json.loads(desescapado)
    except (ValueError, UnicodeDecodeError):
        return None


def buscar_ultimo_capitulo_nyxscans(slug: str) -> float | None:
    """Maior número de capítulo PÚBLICO da obra no nyxscans, ou None."""
    capitulos = buscar_capitulos_nyxscans(slug)
    if not capitulos:
        return None
    numeros = [
        c["number"]
        for c in capitulos
        if c.get("chapterStatus") == "PUBLIC" and isinstance(c.get("number"), (int, float))
    ]
    if not numeros:
        return None
    maior = max(numeros)
    return int(maior) if float(maior).is_integer() else float(maior)


def buscar_candidatos_nyxscans(titulo: str) -> list[tuple[str, str]]:
    """
    Descoberta: consulta a API de busca do nyxscans pelo título e retorna uma
    lista de (titulo_do_resultado, slug). O chamador decide o melhor por
    similaridade. Lista vazia se não achar nada ou se der erro.

    A forma exata da resposta de /api/posts foi inferida da investigação (posts
    com `slug` e `postTitle`); o parsing abaixo é defensivo pra tolerar variações.
    """
    from urllib.parse import quote

    url = f"https://api.nyxscans.com/api/posts?perPage=10&page=1&searchTerm={quote(titulo)}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
    except (requests.RequestException, ValueError):
        return []

    if isinstance(data, list):
        posts = data
    elif isinstance(data, dict):
        posts = data.get("posts") or data.get("data") or data.get("results") or []
    else:
        posts = []

    candidatos = []
    for p in posts:
        if not isinstance(p, dict):
            continue
        slug = p.get("slug")
        titulo_p = p.get("postTitle") or p.get("title") or ""
        if slug:
            candidatos.append((str(titulo_p), str(slug)))
    return candidatos
