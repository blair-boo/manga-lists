"""
Arquitetura de scrapers por adaptador (ver HANDOUT_ARQUITETURA_SCRAPERS).

Cada adaptador serve uma *família de CMS/motor* (não um site individual) e separa
dois eixos independentes:
  - acesso (fetcher): como obter o conteúdo bruto — http / playwright / flaresolverr.
  - leitura (parser): como interpretar o conteúdo e extrair os campos.

A interface (`SourceAdapter`, `RawContent`, `ParseResult`, fetchers, `STATUS_*`)
mora em `adapter_base.py` (ver docstring lá — existe pra evitar import
circular com `adapters_novos.py`). Este módulo define o parser do CMS
genérico, o registry com detect()/diagnose(), e registra tanto os adaptadores
originais quanto os de `adapters_novos.py`.
"""

import json
import re
from dataclasses import dataclass
from urllib.parse import urlparse

import requests

from common import (
    _extrair_array_balanceado,
    buscar_candidatos_cms,
    host_de_url,
    http_get,
    listar_todos_posts_cms,
)
from tipo_titulo import detectar_tipo
from adapter_base import (
    ACCESS_FLARESOLVERR,
    ACCESS_HTTP,
    ACCESS_PLAYWRIGHT,
    FETCHERS,
    ParseResult,
    RawContent,
    STATUS_BLOQUEADO,
    STATUS_ERRO,
    STATUS_INVALIDA,
    STATUS_OK,
    STATUS_VAZIA,
    SourceAdapter,
    fetch_flaresolverr,
    fetch_http,
    fetch_playwright,
    resolver_access_strategy,
)


def _tem_forma_posts(data) -> bool:
    """A resposta de /api/posts tem o formato esperado (lista, ou dict com posts/data/results)?"""
    return isinstance(data, list) or (isinstance(data, dict) and any(k in data for k in ("posts", "data", "results")))


class CmsGenericoAdapter(SourceAdapter):
    """
    CMS Next.js com páginas /series/{slug} (capítulos embutidos no payload RSC) e
    API pública api.{dominio}/api/posts. Cobre nyxscans e qualquer site do mesmo
    motor — inclusive ezmanga (mesmo parser; o que muda no ezmanga é só o acesso,
    resolvido por access_strategy no domínio).
    """

    id = "cms-generico"
    display_name = "CMS Genérico (/series/ + api/posts)"
    access_strategy_padrao = ACCESS_HTTP

    def cfg(self, url: str) -> dict:
        host = host_de_url(url)
        return {"site": f"https://{host}", "api": f"https://api.{host}"}

    def matches(self, url: str) -> bool:
        # Reconhecimento barato: o endpoint api/posts responde com a forma esperada.
        # Não depende de haver capítulo novo — só de reconhecer o motor.
        try:
            resp = http_get(f"{self.cfg(url)['api']}/api/posts?perPage=1&page=1")
        except requests.RequestException:
            return False
        if not resp.ok:
            return False
        try:
            return _tem_forma_posts(resp.json())
        except ValueError:
            return False

    def parse(self, raw: RawContent) -> ParseResult:
        if raw.status == "acesso_bloqueado":
            return ParseResult(STATUS_BLOQUEADO, diagnostico=raw.diagnostico)
        if raw.status != "ok" or not raw.text:
            return ParseResult(STATUS_ERRO, diagnostico=raw.diagnostico or "sem conteúdo")

        bruto = _extrair_array_balanceado(raw.text, r'\"chapters\":[')
        if bruto is None:
            return ParseResult(STATUS_INVALIDA, diagnostico='não achei o array "chapters" no payload RSC')
        try:
            capitulos = json.loads(bruto.encode("utf-8", "backslashreplace").decode("unicode_escape"))
        except (ValueError, UnicodeDecodeError) as exc:
            return ParseResult(STATUS_INVALIDA, diagnostico=f"chapters não parseou: {exc}")

        tipo_detectado = detectar_tipo(raw.url, raw.text)

        numeros = [
            c["number"]
            for c in capitulos
            if isinstance(c, dict) and c.get("chapterStatus") == "PUBLIC" and isinstance(c.get("number"), (int, float))
        ]
        if not numeros:
            return ParseResult(STATUS_VAZIA, diagnostico="estrutura válida, sem capítulos públicos", tipo_detectado=tipo_detectado)
        maior = max(numeros)
        maior = int(maior) if float(maior).is_integer() else float(maior)
        return ParseResult(STATUS_OK, ultimo_capitulo=maior, link_capitulo=raw.url, tipo_detectado=tipo_detectado)

    # Reuso das funções do common para catálogo/busca (usadas por update_obras/discover).
    def listar_catalogo(self, url: str) -> list[tuple[str, str]]:
        return listar_todos_posts_cms(self.cfg(url))

    def buscar(self, url: str, titulo: str) -> list[tuple[str, str]]:
        return buscar_candidatos_cms(self.cfg(url), titulo)

    def url_da_fonte(self, url: str, slug: str) -> str:
        return f"{self.cfg(url)['site']}/series/{slug}"


_NG_STATE_RE = re.compile(r'<script[^>]+id=["\']ng-state["\'][^>]*>(.*?)</script>', re.IGNORECASE | re.DOTALL)
_TITLE_TAG_RE = re.compile(r"<title>(.*?)</title>", re.IGNORECASE | re.DOTALL)


def _achar_array_capitulos(no) -> list | None:
    """
    Busca recursiva no JSON do ng-state (Angular Transfer State) por um array de
    capítulos: lista de dicts com as chaves 'number' e 'publishStatus' (assinatura
    dos itens de `data` descrita no handout do ezmanga). A posição exata do array
    dentro do objeto muda por chave numérica de estado, então a busca é estrutural.
    """
    if isinstance(no, list):
        if no and all(isinstance(it, dict) and "number" in it and "publishStatus" in it for it in no):
            return no
        for item in no:
            achado = _achar_array_capitulos(item)
            if achado is not None:
                return achado
    elif isinstance(no, dict):
        for v in no.values():
            achado = _achar_array_capitulos(v)
            if achado is not None:
                return achado
    return None


class EzmangaAdapter(SourceAdapter):
    """
    CMS Angular com SSR (motor próprio do ezmanga, distinto do CmsGenericoAdapter
    que é Next.js). Não raspa HTML: lê o JSON embutido no bloco
    `<script id="ng-state" type="application/json">` (Angular Transfer State).

    O bloqueio historicamente observado no ezmanga é de reputação de IP
    (Cloudflare), não um challenge de JavaScript — por isso o acesso padrão é
    'http' direto (ver HANDOUT_CONSOLIDADO_PWA, Bloco D). Se a fase 1 (teste
    direto do runner) confirmar bloqueio por ASN, a `access_strategy` do
    domínio troca para um fetcher futuro de proxy residencial/API de scraping,
    sem tocar neste parser.
    """

    id = "ezmanga"
    display_name = "EzManga (Angular ng-state)"
    access_strategy_padrao = ACCESS_HTTP

    def matches(self, url: str) -> bool:
        # Reconhecimento pelo próprio conteúdo (não pelo hostname), pra cobrir
        # qualquer outro site do mesmo motor Angular+ng-state no futuro.
        raw = fetch_http(url)
        if raw.status != "ok" or not raw.text:
            return False
        return _NG_STATE_RE.search(raw.text) is not None

    def _slug_da_url(self, url: str) -> str | None:
        partes = [p for p in urlparse(url).path.split("/") if p]
        if "series" in partes:
            idx = partes.index("series")
            if idx + 1 < len(partes):
                return partes[idx + 1]
        return None

    def _link_capitulo(self, url_obra: str, obra_slug: str | None, capitulo: dict) -> str:
        p = urlparse(url_obra)
        base = f"{p.scheme}://{p.netloc}"
        slug_cap = capitulo.get("slug") or f"chapter-{capitulo.get('number')}"
        if not obra_slug:
            return url_obra
        return f"{base}/series/{obra_slug}/{slug_cap}"

    def _titulo_da_pagina(self, html: str) -> str | None:
        m = _TITLE_TAG_RE.search(html)
        if not m:
            return None
        texto = m.group(1).split("|")[0].strip()
        return texto or None

    def parse(self, raw: RawContent) -> ParseResult:
        if raw.status == "acesso_bloqueado":
            return ParseResult(STATUS_BLOQUEADO, diagnostico=raw.diagnostico)
        if raw.status != "ok" or not raw.text:
            return ParseResult(STATUS_ERRO, diagnostico=raw.diagnostico or "sem conteúdo")

        m = _NG_STATE_RE.search(raw.text)
        if not m:
            return ParseResult(STATUS_INVALIDA, diagnostico='não achei o bloco <script id="ng-state"> no HTML')
        try:
            estado = json.loads(m.group(1))
        except ValueError as exc:
            return ParseResult(STATUS_INVALIDA, diagnostico=f"ng-state não é JSON válido: {exc}")

        capitulos = _achar_array_capitulos(estado)
        if capitulos is None:
            return ParseResult(
                STATUS_INVALIDA,
                diagnostico='ng-state reconhecido, mas sem um array de capítulos com "number"/"publishStatus"',
            )

        tipo_detectado = detectar_tipo(raw.url, raw.text)

        publicos = [
            c for c in capitulos if c.get("publishStatus") == "PUBLIC" and isinstance(c.get("number"), (int, float))
        ]
        if not publicos:
            return ParseResult(
                STATUS_VAZIA,
                diagnostico="ng-state reconhecido, sem capítulos com publishStatus=PUBLIC",
                tipo_detectado=tipo_detectado,
            )

        maior = max(publicos, key=lambda c: c["number"])
        numero = maior["number"]
        numero = int(numero) if float(numero).is_integer() else float(numero)

        obra_slug = self._slug_da_url(raw.url)
        return ParseResult(
            STATUS_OK,
            titulo_site=self._titulo_da_pagina(raw.text),
            tipo_detectado=tipo_detectado,
            ultimo_capitulo=numero,
            link_capitulo=self._link_capitulo(raw.url, obra_slug, maior),
        )


# --- Registry ---------------------------------------------------------------


@dataclass
class DiagnosticEntry:
    adapter_id: str
    matched: bool
    parse_status: str
    mensagem: str


_MSG_STATUS = {
    STATUS_OK: "reconheceu e extraiu os campos",
    STATUS_VAZIA: "reconheceu, estrutura válida mas vazia (possivelmente ok, revisar)",
    STATUS_INVALIDA: "reconheceu, mas o formato divergiu — chegou perto, bom ponto de partida",
    STATUS_BLOQUEADO: "acesso bloqueado (ex.: Cloudflare) — problema de acesso, não de leitura",
    STATUS_ERRO: "falha inesperada",
}


class AdapterRegistry:
    def __init__(self, adapters: list[SourceAdapter]):
        self.adapters = adapters

    def por_id(self, adapter_id: str) -> SourceAdapter | None:
        return next((a for a in self.adapters if a.id == adapter_id), None)

    def detect(self, url: str) -> SourceAdapter | None:
        """Primeiro adaptador cujo matches(url) confirma. None se nenhum reconhecer."""
        for a in self.adapters:
            try:
                if a.matches(url):
                    return a
            except Exception:  # noqa: BLE001 - um matches quebrado não pode derrubar a detecção
                continue
        return None

    def diagnose(self, url: str) -> list[DiagnosticEntry]:
        """Roda quando detect() volta None: tenta todos e registra o que aconteceu em cada um."""
        entradas: list[DiagnosticEntry] = []
        for a in self.adapters:
            try:
                matched = a.matches(url)
            except Exception as exc:  # noqa: BLE001
                entradas.append(DiagnosticEntry(a.id, False, STATUS_ERRO, f"matches() falhou: {exc}"))
                continue
            if not matched:
                entradas.append(DiagnosticEntry(a.id, False, "-", "não reconheceu (não aplicável)"))
                continue
            raw = a.fetch(url, a.access_strategy_padrao)
            pr = a.parse(raw)
            entradas.append(DiagnosticEntry(a.id, True, pr.status, pr.diagnostico or _MSG_STATUS.get(pr.status, "")))
        return entradas


# --- WordPress/Madara/ts_theme: histórico da investigação ------------------
#
# Planejado em 2026-07-16 (handout consolidado B2) e implementado em
# 2026-07-17 (HANDOUT_SCRAPERS_NOVELSHUB_TS_MADARA) em adapters_novos.py.
# A checagem real de cada site corrigiu premissas em duas rodadas:
#
# - Rodada 1 (16/07): achei que kingofshojo/arenascans/mgread seriam uma
#   família "ts_theme" única e que kingofshojo NÃO era Madara.
# - Rodada 2 (17/07, mais profunda — série individual, não só a home):
#   anubisscans.com e hazelnade.com são Madara real (`listing-chapters_wrap`,
#   capítulos via POST `{url}ajax/chapters/?t=1`, não admin-ajax.php).
#   kingofshojo.com e arenascan.com (nome corrigido, sem "s") COMPARTILHAM
#   `eplister`/`chapterlist` (tema Themesia/ts_reader) — kingofshojo É
#   ts_theme afinal, a rodada 1 só tinha checado a home, não a página da
#   série. mgread.io não tem nenhum dos dois marcadores (tema "init-manga"
#   próprio) — adaptador dedicado (`MgreadAdapter`).
#
# Ver adapters_novos.py para as classes (MadaraAdapter, TsThemeAdapter,
# MgreadAdapter) e os demais adaptadores desse handout (NovelsHubAdapter,
# ReadhiveAdapter, VymangaAdapter, MangaFoxAdapter, SakurazeAdapter).
from adapters_novos import (  # noqa: E402
    MadaraAdapter,
    MagustoonAdapter,
    MangaFoxAdapter,
    MgreadAdapter,
    NovelsHubAdapter,
    ReadhiveAdapter,
    SakurazeAdapter,
    TsThemeAdapter,
    VymangaAdapter,
)

REGISTRY = AdapterRegistry(
    [
        # Magustoon vem antes do CmsGenerico de propósito: os dois reconhecem o
        # domínio pela API compartilhada (api/posts), mas só o MagustoonAdapter
        # lê o frontend Astro. Sem essa ordem, o CmsGenerico venceria a detecção
        # e o parse falharia sempre (ver docstring do MagustoonAdapter).
        MagustoonAdapter(),
        CmsGenericoAdapter(),
        EzmangaAdapter(),
        NovelsHubAdapter(),
        ReadhiveAdapter(),
        TsThemeAdapter(),
        MgreadAdapter(),
        MadaraAdapter(),
        VymangaAdapter(),
        MangaFoxAdapter(),
        SakurazeAdapter(),
    ]
)


def carregar_designacoes(supabase) -> dict[str, dict]:
    """
    Mapa host/nome -> {'adaptador', 'access_strategy'} a partir de sites_suportados.
    Usado pelos scrapers para rotear cada fonte pelo adaptador designado ao seu
    domínio, sem redetectar toda vez.
    """
    try:
        rows = (
            supabase.table("sites_suportados")
            .select("nome, url_base, adaptador, access_strategy")
            .execute()
            .data
        )
    except Exception:  # noqa: BLE001
        return {}
    mapa: dict[str, dict] = {}
    for s in rows or []:
        info = {"adaptador": s.get("adaptador"), "access_strategy": s.get("access_strategy")}
        host = host_de_url(s.get("url_base") or "")
        if host:
            mapa[host] = info
        if s.get("nome"):
            mapa[str(s["nome"]).lower()] = info
    return mapa
