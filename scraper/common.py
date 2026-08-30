"""Utilidades compartilhadas pelo scraper (atualizar fontes, descobrir fontes, varrer obras)."""

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from supabase import create_client

import scraping_api

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


def _parece_bloqueio_cloudflare(resp) -> bool:
    if resp.status_code in (403, 503):
        return True
    trecho = (resp.text or "")[:2000].lower()
    return "just a moment" in trecho or "attention required" in trecho or "cf-chl" in trecho


def http_get(url: str, **kwargs):
    """
    GET com timeout padrão pelo cliente compartilhado (Cloudflare-aware).

    Em erro de rede (timeout, conexão) ou resposta 5xx, faz 1 retry após 2s
    antes de propagar/retornar. NÃO retenta em 403/503 com cara de Cloudflare —
    isso já tem o fallback via curl em adapter_base.fetch_http, e insistir só
    queimaria reputação de IP.

    Hosts configurados em SCRAPING_API_HOSTS (com credencial de provider no
    ambiente) são roteados por uma API de scraping (ScraperAPI/scrape.do) que
    resolve o challenge JS do Cloudflare — o caso do comix.to, que challenge
    direto/curl não passa. Roteando aqui, os três estágios (capítulos,
    catálogo, descoberta) herdam o desvio de uma vez, já que todos passam por
    http_get. Sem chave/host, é no-op: segue o caminho direto de sempre.

    O roteamento é a primeira opção, não a única: quando NENHUM provider
    responde (`buscar` devolve None — credencial vencida, cota estourada,
    provider fora do ar), a request cai pro caminho direto abaixo em vez de
    virar erro. Um domínio roteado nunca deve ficar 100% morto só porque a
    conta paga expirou, ainda mais quando o site responde bem sem
    intermediário. Ver scraping_api.py.
    """
    kwargs.setdefault("timeout", TIMEOUT)

    if scraping_api.deve_rotear(url):
        resp = scraping_api.buscar(_sessao_http(), url, params=kwargs.get("params"))
        if resp is not None:
            return resp
        # Todos os providers falharam: segue pro acesso direto (abaixo).

    try:
        resp = _sessao_http().get(url, **kwargs)
    except requests.RequestException:
        time.sleep(2)
        return _sessao_http().get(url, **kwargs)

    if resp.status_code >= 500 and not _parece_bloqueio_cloudflare(resp):
        time.sleep(2)
        return _sessao_http().get(url, **kwargs)

    return resp


# Teto de linhas que o PostgREST devolve por requisição (db-max-rows do
# Supabase). Vale como tamanho de página na paginação abaixo.
PAGINA_SUPABASE = 1000


def buscar_todas(construir_query, tamanho_pagina: int = PAGINA_SUPABASE) -> list[dict]:
    """
    Lê TODAS as linhas de uma query, paginando com `.range()`.

    O PostgREST corta em `db-max-rows` (1000 no Supabase) **em silêncio**: um
    `.select()` numa tabela maior devolve um recorte, sem erro e sem aviso. Era
    o que fazia o estágio de capítulos varrer só 1000 das 1448 fontes
    aprovadas — as outras 448 nunca eram verificadas, e quais entravam no corte
    variava de run pra run (sem ORDER BY a janela é arbitrária). Fontes
    cadastradas/atualizadas pela importação do comix caíam justamente aí: já
    aprovadas, mas invisíveis pro scraper. O front já paginava assim
    (`buscarTudoPaginado` em src/sync/sync.ts, mesmo bug, mesma correção); o
    scraper não.

    `construir_query` é chamado uma vez por página e deve devolver uma query
    NOVA e **ordenada por uma coluna estável** (`.order("id")`) — `.range()` é
    só offset/limit, então sem ORDER BY as páginas não são complementares e
    linhas se repetem ou somem.
    """
    linhas: list[dict] = []
    inicio = 0
    while True:
        pagina = construir_query().range(inicio, inicio + tamanho_pagina - 1).execute().data or []
        linhas.extend(pagina)
        if len(pagina) < tamanho_pagina:
            return linhas
        inicio += tamanho_pagina


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


# Chave em `configuracoes_scraper` onde vive o alerta de "os providers de
# scraping fazem falta". A aba Updates lê essa linha e mostra o aviso.
CHAVE_ALERTA_SCRAPING_API = "scraping_api_alerta"


def registrar_alerta_scraping_api(supabase, origem: str) -> dict[str, str]:
    """
    Fecha o ciclo do stand-by: grava (ou limpa) o alerta de que o caminho pago
    de scraping é necessário de novo.

    Os hosts vêm de `scraping_api.necessidades()`, preenchido durante a run
    toda vez que um domínio configurado leva bloqueio no acesso direto. Com os
    providers em stand-by, esse é o único sinal de que as chaves precisam
    voltar — sem ele o scraper simplesmente pararia de achar capítulo naquele
    site, em silêncio.

    O registro é por `origem` ('capitulos', 'obras', ...): cada run sobrescreve
    só a própria chave, então uma run limpa não apaga o alerta que outro
    estágio acabou de levantar. Devolve os hosts que precisaram do caminho pago
    (vazio = nada a renovar).

    Best-effort: falha aqui (tabela ausente, RLS) não derruba a run — o alerta
    é diagnóstico, não o trabalho.
    """
    hosts = scraping_api.necessidades()
    try:
        resp = supabase.table("configuracoes_scraper").select("valor").eq("chave", CHAVE_ALERTA_SCRAPING_API).execute()
        atual = resp.data[0]["valor"] if resp.data and isinstance(resp.data[0].get("valor"), dict) else {}
        atual[origem] = {"hosts": hosts, "em": datetime.now(timezone.utc).isoformat()}
        supabase.table("configuracoes_scraper").upsert(
            {"chave": CHAVE_ALERTA_SCRAPING_API, "valor": atual}
        ).execute()
    except Exception as exc:  # noqa: BLE001 - diagnóstico não pode derrubar a run
        print(f"  aviso: não consegui gravar o alerta de scraping_api: {exc}", file=sys.stderr)

    if hosts:
        print(
            "\nATENÇÃO: estes domínios ficaram bloqueados no acesso direto e precisam "
            "das APIs de scraping (renove as secrets):",
            file=sys.stderr,
        )
        for host, diag in hosts.items():
            print(f"  - {host}: {diag}", file=sys.stderr)
    return hosts


def carregar_dominios_bloqueados(supabase) -> set[str]:
    """Conjunto de domínios em blacklist (dominios_bloqueados). Vazio se a tabela não existir."""
    try:
        linhas = buscar_todas(lambda: supabase.table("dominios_bloqueados").select("dominio").order("dominio"))
    except Exception:  # noqa: BLE001
        return set()
    return {row["dominio"] for row in linhas if row.get("dominio")}


def finalizar_run(supabase, run_id: str, status: str, mensagem: str | None = None, resumo: dict | None = None) -> None:
    """status: 'concluido' | 'erro'. resumo: contadores estruturados (ex.: {"verificadas": n, "falhas": n})."""
    registro = {"status": status, "finalizado_em": datetime.now(timezone.utc).isoformat(), "mensagem": mensagem}
    if resumo is not None:
        try:
            supabase.table("scraper_runs").update({**registro, "resumo": resumo}).eq("id", run_id).execute()
            return
        except Exception:  # noqa: BLE001 - coluna resumo pode não existir (migração 0009 é manual)
            pass  # cai no update sem resumo abaixo; finalizar a run importa mais que o contador
    supabase.table("scraper_runs").update(registro).eq("id", run_id).execute()


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
