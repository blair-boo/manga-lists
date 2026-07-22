"""
Fetch do Novel Updates via Playwright (Handout 4, Fase 2). Um browser/contexto
por run, reutilizado entre requests (mantém cookies/cf_clearance). Devolve HTML
já com o desafio do Cloudflare resolvido, ou None se bloqueado.

O binário do Chromium NÃO vem do pip: é instalado no workflow com
`python -m playwright install --with-deps chromium`.
"""

from contextlib import contextmanager

from playwright.sync_api import sync_playwright

MARCADORES_CHALLENGE = (
    "just a moment",
    "cf-challenge",
    "challenge-platform",
    "attention required",
    "cf-turnstile",
)
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)


class NuBrowser:
    def __init__(self, pagina):
        self._pagina = pagina

    def get_html(self, url: str, timeout_ms: int = 60000) -> str | None:
        """HTML final da URL (desafio resolvido) ou None se bloqueado/erro."""
        try:
            resp = self._pagina.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
        except Exception:
            return None
        if resp is not None and resp.status in (403, 429):
            # dá uma chance ao desafio antes de desistir
            pass
        try:
            self._pagina.wait_for_function(
                """() => !document.title.toLowerCase().includes('just a moment')""",
                timeout=40000,
            )
        except Exception:
            pass
        html = self._pagina.content()
        baixo = html.lower()
        if any(m in baixo for m in MARCADORES_CHALLENGE) and "og:url" not in baixo:
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
