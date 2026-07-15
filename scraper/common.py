"""Utilidades compartilhadas pelo scraper (atualizar fontes, descobrir fontes, varrer obras)."""

import json
import os
import re
from pathlib import Path
from urllib.parse import urljoin, urlparse

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

# Sites que rodam o mesmo CMS Next.js (páginas /series/{slug} com a lista de
# capítulos embutida no payload RSC, e uma API pública {api}/api/posts). Vários
# sites de scan usam esse mesmo template — adicionar um novo é só mapear aqui.
SITES_NEXTJS_CMS = {
    "nyxscans": {"site": "https://nyxscans.com", "api": "https://api.nyxscans.com"},
    "ezmanga": {"site": "https://ezmanga.org", "api": "https://api.ezmanga.org"},
}

# --- Cliente HTTP (com tentativa de contornar Cloudflare) -------------------

_sessao = None


def _sessao_http():
    """
    Sessão HTTP compartilhada. Usa cloudscraper (resolve o desafio JS do
    Cloudflare, comum em sites tipo ezmanga) quando disponível; senão cai numa
    requests.Session normal. cloudscraper é construído sobre requests, então as
    exceções continuam sendo requests.RequestException.
    """
    global _sessao
    if _sessao is None:
        try:
            import cloudscraper

            _sessao = cloudscraper.create_scraper()
        except Exception:  # noqa: BLE001 - sem cloudscraper, segue com requests
            _sessao = requests.Session()
            _sessao.headers.update(HEADERS)
    return _sessao


def http_get(url: str, **kwargs):
    """GET com timeout padrão pelo cliente compartilhado (Cloudflare-aware)."""
    kwargs.setdefault("timeout", TIMEOUT)
    return _sessao_http().get(url, **kwargs)


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


def iniciar_run(supabase, tipo: str, site_dominio: str | None = None) -> str:
    """
    Registra o início de uma execução do scraper. tipo: 'capitulos' | 'obras' | 'fontes'.
    site_dominio é preenchido pelas runs por site (ex.: 'obras' varre um site por vez);
    fica nulo nas buscas globais. Retorna o id da run.
    """
    registro = {"tipo": tipo, "status": "rodando"}
    if site_dominio is not None:
        registro["site_dominio"] = site_dominio
    resp = supabase.table("scraper_runs").insert(registro).execute()
    return resp.data[0]["id"]


def carregar_config_match(supabase) -> dict:
    """
    Lê os limiares de match de título de `configuracoes_scraper` (chave 'match_titulo').
    Se a linha não existir, cai num default seguro (mesmos valores do seed da migração).
    """
    default = {
        "atualizar_obras": {"limiar_auto_aprovacao": 0.95, "limiar_minimo_pendencia": 0.70},
        "buscar_novas_fontes": {"limiar_auto_aprovacao": 0.95, "limiar_minimo_pendencia": 0.85},
    }
    try:
        resp = supabase.table("configuracoes_scraper").select("valor").eq("chave", "match_titulo").execute()
    except Exception:  # noqa: BLE001 - tabela pode não existir ainda; usa default
        return default
    if resp.data and isinstance(resp.data[0].get("valor"), dict):
        return resp.data[0]["valor"]
    return default


def carregar_dominios_bloqueados(supabase) -> set[str]:
    """Conjunto de domínios em blacklist (dominios_bloqueados). Vazio se a tabela não existir."""
    try:
        resp = supabase.table("dominios_bloqueados").select("dominio").execute()
    except Exception:  # noqa: BLE001
        return set()
    return {row["dominio"] for row in (resp.data or []) if row.get("dominio")}


def finalizar_run(supabase, run_id: str, status: str, mensagem: str | None = None) -> None:
    """status: 'concluido' | 'erro'."""
    from datetime import datetime, timezone

    supabase.table("scraper_runs").update(
        {"status": status, "finalizado_em": datetime.now(timezone.utc).isoformat(), "mensagem": mensagem}
    ).eq("id", run_id).execute()


# --- URLs -------------------------------------------------------------------


def host_de_url(url: str) -> str:
    """Host de uma URL (minúsculo, sem 'www.'). Vazio se inválida ou relativa."""
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def resolver_url(url: str, base: str | None) -> str:
    """
    Torna uma URL absoluta. Se já tem esquema (http/https), retorna como está;
    se for relativa (ex.: '/series/foo'), junta com `base`. Conserta as fontes
    antigas que foram salvas sem domínio.
    """
    if not url or urlparse(url).scheme:
        return url
    return urljoin(base, url) if base else url


# --- CMS Next.js (nyxscans, ezmanga, …) -------------------------------------
#
# Cada página /series/{slug} traz a lista completa de capítulos embutida no
# HTML, dentro do payload RSC do Next.js (`self.__next_f.push([1,"..."])`), com
# aspas JSON escapadas (`\"chapters\":[...]`). Uma requisição HTTP simples por
# obra basta. O catálogo/busca vem da API pública {api}/api/posts.


def cms_por_url(url: str):
    """Retorna (nome, cfg) do CMS Next.js correspondente ao host da URL, ou None."""
    host = host_de_url(url)
    if not host:
        return None
    for nome, cfg in SITES_NEXTJS_CMS.items():
        if host_de_url(cfg["site"]) == host:
            return nome, cfg
    return None


def slug_de_url_series(url: str) -> str | None:
    """Extrai o slug de uma URL tipo .../series/{slug} (relativa ou absoluta)."""
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
    guloso. Retorna o trecho bruto (ainda com escapes `\"`), ou None se não achar.
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


def _extrair_posts(data) -> list[dict]:
    """Normaliza a resposta de /api/posts para uma lista de dicts (defensivo)."""
    if isinstance(data, list):
        return [p for p in data if isinstance(p, dict)]
    if isinstance(data, dict):
        posts = data.get("posts") or data.get("data") or data.get("results") or []
        return [p for p in posts if isinstance(p, dict)]
    return []


def buscar_capitulos_cms(cfg: dict, slug: str) -> list[dict] | None:
    """Lista completa de capítulos de uma obra (payload RSC embutido). None se não achar."""
    resp = http_get(f"{cfg['site']}/series/{slug}")
    resp.raise_for_status()
    bruto = _extrair_array_balanceado(resp.text, r'\"chapters\":[')
    if bruto is None:
        return None
    try:
        desescapado = bruto.encode("utf-8", "backslashreplace").decode("unicode_escape")
        return json.loads(desescapado)
    except (ValueError, UnicodeDecodeError):
        return None


def buscar_ultimo_capitulo_cms(cfg: dict, slug: str) -> float | None:
    """Maior número de capítulo PÚBLICO da obra, ou None."""
    capitulos = buscar_capitulos_cms(cfg, slug)
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


def buscar_candidatos_cms(cfg: dict, titulo: str) -> list[tuple[str, str]]:
    """Busca na API do CMS pelo título; retorna [(postTitle, slug), …]. Vazio em erro."""
    from urllib.parse import quote

    url = f"{cfg['api']}/api/posts?perPage=10&page=1&searchTerm={quote(titulo)}"
    try:
        resp = http_get(url)
        resp.raise_for_status()
        posts = _extrair_posts(resp.json())
    except (requests.RequestException, ValueError):
        return []
    candidatos = []
    for p in posts:
        slug = p.get("slug")
        if slug:
            candidatos.append((str(p.get("postTitle") or p.get("title") or ""), str(slug)))
    return candidatos


def listar_todos_posts_cms(cfg: dict, per_page: int = 50, max_paginas: int = 200) -> list[tuple[str, str]]:
    """Catálogo completo do CMS: pagina /api/posts (sem searchTerm) -> [(postTitle, slug), …]."""
    catalogo: list[tuple[str, str]] = []
    vistos: set[str] = set()
    for page in range(1, max_paginas + 1):
        url = f"{cfg['api']}/api/posts?perPage={per_page}&page={page}"
        try:
            resp = http_get(url)
            resp.raise_for_status()
            posts = _extrair_posts(resp.json())
        except (requests.RequestException, ValueError):
            break
        if not posts:
            break
        novos = 0
        for p in posts:
            slug = p.get("slug")
            if not slug or slug in vistos:
                continue
            vistos.add(str(slug))
            catalogo.append((str(p.get("postTitle") or p.get("title") or ""), str(slug)))
            novos += 1
        if novos == 0:  # página só com slugs repetidos: fim do catálogo
            break
    return catalogo


def extrair_maior_capitulo(html: str) -> float | None:
    """
    Extração genérica do maior número de capítulo encontrado no HTML (href + texto
    dos links). Heurística site-agnóstica para agregadores comuns ("chapter-123"
    na URL ou "Chapter 123" no texto do link).
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
