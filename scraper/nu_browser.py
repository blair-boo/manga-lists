"""
Fetch do Novel Updates via Playwright (Handout 4, Fase 2). Um browser/contexto
por run, reutilizado entre requests (mantém cookies/cf_clearance). Devolve HTML
já com o desafio do Cloudflare resolvido, ou None se bloqueado.

O binário do Chromium NÃO vem do pip: é instalado no workflow com
`python -m playwright install --with-deps chromium`.
"""

from contextlib import contextmanager

from playwright.sync_api import sync_playwright

# Marcadores da PÁGINA de desafio/bloqueio em si (interstitial), não de scripts
# que o Cloudflare injeta em páginas normais. Importante: NÃO usar "challenge-platform"
# nem "cf-turnstile" soltos — eles aparecem no <head> de páginas servidas com sucesso
# (ex.: a página de resultados de busca, que não tem og:url), gerando falso "bloqueado".
# Estes só existem na interstitial "Just a moment" / no bloqueio 1020.
MARCADORES_INTERSTICIAL = (
    "just a moment",       # <title> da interstitial de managed challenge
    "attention required",  # <title> do bloqueio 1020
    "_cf_chl_opt",         # objeto JS de config do desafio (só na interstitial)
    "challenge-form",      # <form id="challenge-form"> da interstitial
    "cf-error-details",    # página de erro/bloqueio do Cloudflare
)
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)


def _esta_bloqueado(html: str) -> bool:
    baixo = html.lower()
    return any(m in baixo for m in MARCADORES_INTERSTICIAL)


class NuBrowser:
    def __init__(self, pagina):
        self._pagina = pagina

    def get_html(self, url: str, timeout_ms: int = 60000) -> str | None:
        """HTML final da URL (desafio resolvido) ou None se bloqueado/erro."""
        try:
            self._pagina.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
        except Exception:
            return None
        # Dá tempo do desafio JS resolver, se houver: espera o <title> deixar de
        # ser a interstitial "Just a moment" (teto de 40s). Páginas normais já
        # entram com título real, então isso retorna na hora — sem espera.
        try:
            self._pagina.wait_for_function(
                """() => !document.title.toLowerCase().includes('just a moment')""",
                timeout=40000,
            )
        except Exception:
            pass
        html = self._pagina.content()
        if _esta_bloqueado(html):
            return None
        return html


@contextmanager
def abrir_nu_browser():
    with sync_playwright() as p:
        navegador = p.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        )
        contexto = navegador.new_context(
            user_agent=UA, locale="en-US", viewport={"width": 1366, "height": 768}
        )
        pagina = contexto.new_page()
        try:
            yield NuBrowser(pagina)
        finally:
            navegador.close()
