"""
Sonda de acesso ao Novel Updates via Playwright (Handout 4 + diagnóstico de
escala). NÃO faz parte do scraper de produção.

Testa se o Cloudflare do NU aguenta MÚLTIPLAS requisições seguidas de páginas de
série numa mesma sessão de browser (o cenário real do scraper). Uma única página
passa (sonda anterior); a dúvida é se a 2ª..Nª começam a tomar desafio/timeout.

Carrega N páginas de série conhecidas, em sequência, com um pequeno delay, e
imprime status/título/marcadores/tempo de cada uma.

Uso: python scraper/probe_novelupdates.py
Sai 0 se TODAS passaram (og:url presente); 1 se alguma foi bloqueada.
"""

import sys
import time

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

try:
    from playwright_stealth import stealth_sync  # type: ignore
except Exception:  # pragma: no cover - fallback p/ variação de API
    stealth_sync = None

# Séries reais e estáveis do NU (slugs derivados de títulos conhecidos).
ALVOS = [
    "https://www.novelupdates.com/series/unbeknownst-to-me-i-am-secretly-dating-the-emperor/",
    "https://www.novelupdates.com/series/solo-leveling/",
    "https://www.novelupdates.com/series/the-beginning-after-the-end/",
    "https://www.novelupdates.com/series/omniscient-readers-viewpoint/",
    "https://www.novelupdates.com/series/the-remarried-empress/",
    "https://www.novelupdates.com/series/lord-of-the-mysteries/",
]
MARCADORES_INTERSTICIAL = (
    "just a moment",
    "attention required",
    "_cf_chl_opt",
    "challenge-form",
    "cf-error-details",
)
DELAY = 1.5


def carregar(pagina, url):
    t0 = time.time()
    resp = pagina.goto(url, wait_until="domcontentloaded", timeout=60000)
    status = resp.status if resp else None
    try:
        pagina.wait_for_function(
            """() => !document.title.toLowerCase().includes('just a moment')""",
            timeout=40000,
        )
    except Exception:
        pass
    html = pagina.content()
    return status, pagina.title(), html, time.time() - t0


def main():
    resultados = []
    with sync_playwright() as p:
        navegador = p.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        )
        contexto = navegador.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/125.0.0.0 Safari/537.36"
            ),
            locale="en-US",
            viewport={"width": 1366, "height": 768},
        )
        pagina = contexto.new_page()
        if stealth_sync is not None:
            try:
                stealth_sync(pagina)
                print("stealth aplicado")
            except Exception as exc:
                print(f"stealth falhou: {exc}")
        else:
            print("playwright_stealth indisponível")

        for i, url in enumerate(ALVOS, 1):
            time.sleep(DELAY)
            status, titulo, html, dt = carregar(pagina, url)
            baixo = html.lower()
            marcadores = [m for m in MARCADORES_INTERSTICIAL if m in baixo]
            tem_og = "og:url" in baixo
            passou = tem_og and not marcadores
            resultados.append(passou)
            print(
                f"[{i}] {dt:5.1f}s status={status} og:url={tem_og} "
                f"marcadores={marcadores} title={titulo!r}"
            )

        navegador.close()

    passaram = sum(resultados)
    print(f"\nRESUMO: {passaram}/{len(ALVOS)} páginas de série passaram.")
    sys.exit(0 if passaram == len(ALVOS) else 1)


if __name__ == "__main__":
    main()
