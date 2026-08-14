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

import re
import shutil
import subprocess
from dataclasses import dataclass

import requests

from common import http_get

_CURL_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
_TEM_CURL = shutil.which("curl") is not None

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


def _fetch_via_curl(url: str) -> RawContent | None:
    """
    Fallback via binário `curl` (subprocess) quando requests/cloudscraper
    apanham bloqueio. Alguns sites bloqueiam pelo fingerprint TLS do cliente
    Python (JA3), não por reputação de IP — confirmado num caso real
    (novelshub/valirscans.org): `requests`/cloudscraper levam 403, `curl` com
    o mesmo IP/rede passa normal. `curl` já vem instalado nos runners
    ubuntu-latest do GitHub Actions, então não é uma dependência nova.
    Retorna None se `curl` não estiver disponível (deixa o chamador decidir).
    """
    if not _TEM_CURL:
        return None
    try:
        resultado = subprocess.run(
            ["curl", "-sS", "-L", "-m", "20", "-A", _CURL_UA, "-w", "\n__HTTP_CODE__%{http_code}", url],
            capture_output=True,
            text=True,
            timeout=25,
        )
    except (subprocess.SubprocessError, OSError):
        return None
    if resultado.returncode != 0:
        return None

    saida = resultado.stdout
    marcador = "\n__HTTP_CODE__"
    idx = saida.rfind(marcador)
    if idx == -1:
        return None
    corpo, codigo_str = saida[:idx], saida[idx + len(marcador) :].strip()
    try:
        codigo = int(codigo_str)
    except ValueError:
        return None

    if codigo in (403, 503) or "just a moment" in corpo[:2000].lower():
        return RawContent("acesso_bloqueado", url, diagnostico=f"curl também bloqueado (HTTP {codigo})")
    if codigo >= 400:
        return RawContent("erro", url, diagnostico=f"curl HTTP {codigo}")
    return RawContent("ok", url, text=corpo)


def fetch_http(url: str) -> RawContent:
    """
    Acesso HTTP direto (cliente Cloudflare-aware do common). Se o cliente
    Python (requests/cloudscraper) apanhar bloqueio, tenta uma vez via `curl`
    antes de desistir — ver `_fetch_via_curl`.
    """
    try:
        resp = http_get(url)
    except requests.RequestException as exc:
        bloqueado = "403" in str(exc) or "cloudflare" in str(exc).lower()
        if bloqueado:
            via_curl = _fetch_via_curl(url)
            if via_curl is not None:
                return via_curl
        return RawContent("acesso_bloqueado" if bloqueado else "erro", url, diagnostico=str(exc))
    if _parece_cloudflare(resp):
        via_curl = _fetch_via_curl(url)
        if via_curl is not None:
            return via_curl
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
    # Valor já mapeado pro enum StatusPublicacao do app ('Ongoing'/'Completed'/
    # 'Hiatus'/'Canceled'/'One shot'), ou None quando o adaptador não relata
    # status de publicação (a maioria não relata). Cada adaptador é responsável
    # por traduzir o vocabulário do site pro enum do app — update_fontes.py só
    # propaga o valor já traduzido, sem saber de onde veio.
    status_publicacao_detectado: str | None = None


# --- Capítulo detectado pela varredura do Reader -----------------------------


@dataclass
class CapituloDetectado:
    """
    Um capítulo como a varredura o enxerga na LISTA da obra. Só metadado —
    nenhum texto de capítulo passa por aqui; o download é outra fase.

    `chave` é a identidade dentro da obra e NÃO é a URL: nos temas Madara o
    capítulo atrás de paywall vem com href="#" e só ganha URL quando o paywall
    cai. Usar URL duplicaria os bloqueados e perderia o vínculo na liberação
    (ver migration 0022).
    """

    chave: str
    numero: float | None = None
    numero_texto: str | None = None  # rótulo cru do site, ex. "Side Story 3"
    titulo: str | None = None
    side_story: bool = False
    url: str | None = None  # None enquanto bloqueado
    bloqueado: bool = False
    disponivel_em: str | None = None  # 'YYYY-MM-DD' quando o site informa
    id_externo: str | None = None
    ordem: float | None = None


def chave_capitulo(numero: float | None, side_story: bool, numero_texto: str | None = None) -> str:
    """
    Identidade do capítulo dentro da obra, derivada do rótulo do site.

    ESPELHO EXATO de `chaveCapitulo` em src/lib/reader.ts — se mudar aqui, mude
    lá: divergir faz a varredura deixar de reconhecer o que o app cadastrou (e
    vice-versa), duplicando tudo.

    Side story ganha prefixo 'ss-' porque a numeração dela corre num eixo
    próprio: existe "Side Story 3" numa obra que também tem "Chapter 3".
    """
    prefixo = "ss-" if side_story else ""
    if numero is not None:
        # Normaliza a representação como o JS faz: 143.0 -> '143', 143.20 -> '143.2'.
        numero_fmt = int(numero) if float(numero).is_integer() else float(numero)
        return f"{prefixo}{numero_fmt}"
    cru = (numero_texto or "").strip().lower()
    if cru:
        limpo = re.sub(r"[^a-z0-9.]+", "-", cru).strip("-")
        return f"{prefixo}{limpo}"
    return ""


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

    # --- Aba Reader ---------------------------------------------------------
    #
    # `parse()` reduz a lista a UM número (o último capítulo lançado) porque é
    # o que o update_fontes.py precisa. A aba Reader precisa da lista inteira,
    # com bloqueio e data de liberação — daí um método separado em vez de
    # inchar o ParseResult.
    #
    # É OPCIONAL de propósito: adaptador que não implementa devolve None, e a
    # varredura simplesmente reporta "sem suporte" pra aquele domínio, sem
    # quebrar. Assim dá pra implementar site a site sem tocar nos outros.

    def listar_capitulos(self, raw: RawContent) -> list["CapituloDetectado"] | None:
        return None
