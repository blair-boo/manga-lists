"""
Peças de base da arquitetura de adaptadores (ver HANDOUT_ARQUITETURA_SCRAPERS):
interface `SourceAdapter`, `RawContent`/`ParseResult`, os fetchers por eixo de
acesso e `resolver_access_strategy`.

Separado de `adapters.py` pra quebrar o ciclo de import: `adapters.py` (que
define os adaptadores originais + o REGISTRY) e `adapters_novos.py` (que
define os adaptadores do handout de novelshub/ts_theme/madara) precisam ambos
importar essas peças, e `adapters.py` também importa as classes de
`adapters_novos.py` pra registrá-las — sem um módulo comum, os dois módulos
tentariam se importar um ao outro.
"""

from dataclasses import dataclass

import requests

from common import http_get

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
    tipo_detectado: str | None = None  # 'manga' | 'novel' | None (indefinido; ver tipo_titulo.py)


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
