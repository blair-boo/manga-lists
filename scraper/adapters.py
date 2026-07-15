"""
Arquitetura de scrapers por adaptador (ver HANDOUT_ARQUITETURA_SCRAPERS).

Cada adaptador serve uma *família de CMS/motor* (não um site individual) e separa
dois eixos independentes:
  - acesso (fetcher): como obter o conteúdo bruto — http / playwright / flaresolverr.
  - leitura (parser): como interpretar o conteúdo e extrair os campos.

Este módulo é aditivo: define a interface, os fetchers, o parser do CMS genérico
e o registry com detect()/diagnose(). O wiring nos scrapers (update_fontes etc.)
é feito à parte, reusando estas peças.
"""

import json
from dataclasses import dataclass

import requests

from common import (
    _extrair_array_balanceado,
    buscar_candidatos_cms,
    host_de_url,
    http_get,
    listar_todos_posts_cms,
)

# --- Eixo de acesso (fetchers) ---------------------------------------------

ACCESS_HTTP = "http"
ACCESS_PLAYWRIGHT = "playwright"
ACCESS_FLARESOLVERR = "flaresolverr"


@dataclass
class RawContent:
    """Conteúdo bruto obtido pelo fetcher, com status de acesso explícito."""

    status: str  # 'ok' | 'acesso_bloqueado' | 'erro'
    url: str
    text: str | None = None
    diagnostico: str | None = None


def _parece_cloudflare(resp) -> bool:
    if resp.status_code in (403, 503):
        return True
    trecho = (resp.text or "")[:2000].lower()
    return "just a moment" in trecho or "attention required" in trecho or "cf-chl" in trecho


def fetch_http(url: str) -> RawContent:
    """Acesso HTTP direto (cliente Cloudflare-aware do common)."""
    try:
        resp = http_get(url)
    except requests.RequestException as exc:
        bloqueado = "403" in str(exc) or "cloudflare" in str(exc).lower()
        return RawContent("acesso_bloqueado" if bloqueado else "erro", url, diagnostico=str(exc))
    if _parece_cloudflare(resp):
        return RawContent("acesso_bloqueado", url, diagnostico=f"HTTP {resp.status_code} (possível Cloudflare)")
    if not resp.ok:
        return RawContent("erro", url, diagnostico=f"HTTP {resp.status_code}")
    return RawContent("ok", url, text=resp.text)


def fetch_playwright(url: str) -> RawContent:
    """Stub: renderização com browser headless ainda não configurada."""
    return RawContent("erro", url, diagnostico="fetcher 'playwright' ainda não configurado (stub)")


def fetch_flaresolverr(url: str) -> RawContent:
    """Stub: solver de Cloudflare ainda não configurado — retorna acesso bloqueado (esperado)."""
    return RawContent("acesso_bloqueado", url, diagnostico="fetcher 'flaresolverr' ainda não configurado (stub)")


FETCHERS = {
    ACCESS_HTTP: fetch_http,
    ACCESS_PLAYWRIGHT: fetch_playwright,
    ACCESS_FLARESOLVERR: fetch_flaresolverr,
}


def resolver_access_strategy(access_strategy_dominio: str | None, adapter: "SourceAdapter | None") -> str:
    """Estratégia do domínio, se existir; senão, o padrão do adaptador; senão, http."""
    if access_strategy_dominio:
        return access_strategy_dominio
    if adapter is not None:
        return adapter.access_strategy_padrao
    return ACCESS_HTTP


# --- Eixo de leitura (parser) ----------------------------------------------

# Valores de status do ParseResult:
STATUS_OK = "ok"  # extraiu os campos
STATUS_VAZIA = "estrutura_vazia"  # estrutura válida, mas lista vazia (pode ser normal)
STATUS_INVALIDA = "estrutura_invalida"  # formato inesperado (motor mudou / não é este CMS)
STATUS_BLOQUEADO = "acesso_bloqueado"  # não acessou (ex.: Cloudflare)
STATUS_ERRO = "erro"  # falha inesperada


@dataclass
class ParseResult:
    status: str
    titulo_site: str | None = None
    ultimo_capitulo: float | None = None
    link_capitulo: str | None = None
    diagnostico: str | None = None


# --- Interface do adaptador -------------------------------------------------


class SourceAdapter:
    id: str = ""
    display_name: str = ""
    access_strategy_padrao: str = ACCESS_HTTP

    def matches(self, url: str) -> bool:
        raise NotImplementedError

    def fetch(self, url: str, access_strategy: str) -> RawContent:
        return FETCHERS.get(access_strategy, fetch_http)(url)

    def parse(self, raw: RawContent) -> ParseResult:
        raise NotImplementedError


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

        numeros = [
            c["number"]
            for c in capitulos
            if isinstance(c, dict) and c.get("chapterStatus") == "PUBLIC" and isinstance(c.get("number"), (int, float))
        ]
        if not numeros:
            return ParseResult(STATUS_VAZIA, diagnostico="estrutura válida, sem capítulos públicos")
        maior = max(numeros)
        maior = int(maior) if float(maior).is_integer() else float(maior)
        return ParseResult(STATUS_OK, ultimo_capitulo=maior, link_capitulo=raw.url)

    # Reuso das funções do common para catálogo/busca (usadas por update_obras/discover).
    def listar_catalogo(self, url: str) -> list[tuple[str, str]]:
        return listar_todos_posts_cms(self.cfg(url))

    def buscar(self, url: str, titulo: str) -> list[tuple[str, str]]:
        return buscar_candidatos_cms(self.cfg(url), titulo)

    def url_da_fonte(self, url: str, slug: str) -> str:
        return f"{self.cfg(url)['site']}/series/{slug}"


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


# Registry global com os adaptadores disponíveis.
REGISTRY = AdapterRegistry([CmsGenericoAdapter()])


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
