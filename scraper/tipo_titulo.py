"""
Detecção de tipo (manga vs novel) de uma fonte/obra, por hierarquia de sinais
(HANDOUT_CONSOLIDADO_PWA, Bloco B1). Manga, manhwa e manhua não se distinguem
para efeito de fontes — são todos tratados como 'manga'; a distinção relevante
é só manga vs novel.

Hierarquia (para no primeiro sinal que decidir):
  1. URL — segmento '/novel/' ou sufixo '-novel' no slug; palavras-chave de
     manga no caminho.
  2. Título da página (<title>) — palavras-chave, com NOVEL vencendo em caso
     de conflito (ex.: "[Novel] Manga" no título do nyxscans).
  3. Metadados (og:type) — só decide no caso forte 'books.book' -> novel.
  4. None — indefinido, cai para decisão manual (fila de aprovação).

'series' não é usado como sinal isolado de novel (fraco demais: nyxscans e
ezmanga, que são de manga, também usam '/series/').
"""

import re

NOVEL_KEYWORDS = ("novel", "light novel", "webnovel", "book")
MANGA_KEYWORDS = ("manga", "mangá", "manhwa", "manhua", "comic", "comics", "webtoon")

_OG_TYPE_RE = re.compile(r'<meta[^>]+property=["\']og:type["\'][^>]+content=["\']([^"\']+)["\']', re.IGNORECASE)
_TITLE_TAG_RE = re.compile(r"<title>(.*?)</title>", re.IGNORECASE | re.DOTALL)
_SLUG_NOVEL_RE = re.compile(r"-novel(?:/|$|[?#])")


def _tem_palavra(texto: str, palavras: tuple[str, ...]) -> bool:
    texto_l = texto.lower()
    return any(p in texto_l for p in palavras)


def por_url(url: str) -> str | None:
    """Sinal mais confiável: segmento '/novel/' ou sufixo '-novel' no slug."""
    if not url:
        return None
    caminho = url.lower()
    if "/novel/" in caminho or _SLUG_NOVEL_RE.search(caminho):
        return "novel"
    if _tem_palavra(caminho, MANGA_KEYWORDS):
        return "manga"
    return None


def por_titulo_pagina(titulo: str) -> str | None:
    """Palavras-chave no <title> da página. NOVEL vence quando ambas aparecem."""
    if not titulo:
        return None
    if _tem_palavra(titulo, NOVEL_KEYWORDS):
        return "novel"
    if _tem_palavra(titulo, MANGA_KEYWORDS):
        return "manga"
    return None


def por_og_type(html: str) -> str | None:
    """Metadado Open Graph. Só decide no caso forte (books.book -> novel)."""
    if not html:
        return None
    m = _OG_TYPE_RE.search(html)
    if not m:
        return None
    return "novel" if "book" in m.group(1).lower() else None


def extrair_titulo_pagina(html: str) -> str:
    if not html:
        return ""
    m = _TITLE_TAG_RE.search(html)
    return m.group(1).strip() if m else ""


def familia_de_tipo(tipo_obra: str | None) -> str | None:
    """
    Mapeia `obras.tipo` (Manga/Manwha/Manhua/Novel) pra família 'manga'/'novel'
    usada na comparação com o tipo detectado de uma fonte. Manga/Manwha/Manhua
    não se distinguem aqui (B0) — só manga vs novel importa.
    """
    if tipo_obra is None:
        return None
    if tipo_obra == "Novel":
        return "novel"
    if tipo_obra in ("Manga", "Manwha", "Manhua"):
        return "manga"
    return None


def detectar_tipo(url: str, html: str | None = None) -> str | None:
    """Aplica a hierarquia completa (URL > título > og:type). None = indefinido."""
    resultado = por_url(url)
    if resultado is not None:
        return resultado

    if not html:
        return None

    resultado = por_titulo_pagina(extrair_titulo_pagina(html))
    if resultado is not None:
        return resultado

    return por_og_type(html)
