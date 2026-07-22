"""
Sonda de acesso ao Novel Updates via Playwright (Handout 4, Fase 1 + diagnóstico
do endpoint de busca). NÃO faz parte do scraper de produção.

Testa DOIS endpoints e imprime diagnóstico de cada um:
  1) uma página de série (deve passar — o Cloudflare serve páginas cacheadas);
  2) o endpoint de busca ?s=... (suspeito de bloqueio 403/challenge próprio).

Uso: python scraper/probe_novelupdates.py
Sai 0 se a página de série passou; 1 caso contrário.
"""

import re
import sys

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

SERIE = "https://www.novelupdates.com/series/unbeknownst-to-me-i-am-secretly-dating-the-emperor/"
BUSCA = "https://www.novelupdates.com/?s=Solo%20Leveling&post_type=seriesplans"
MARCADORES_INTERSTICIAL = (
    "just a moment",
    "attention required",
    "_cf_chl_opt",
    "challenge-form",
    "cf-error-details",
)


def carregar(pagina, url):
    resp = pagina.goto(url, wait_until="domcontentloaded", timeout=60000)
    status = resp.status if resp else None
    try:
        pagina.wait_for_function(
            """() => !document.title.toLowerCase().includes('just a moment')""",
            timeout=40000,
        )
    except Exception:
        pass
    return status, pagina.title(), pagina.content()


def diagnostico(rotulo, status, titulo, html):
    baixo = html.lower()
    marcadores = [m for m in MARCADORES_INTERSTICIAL if m in baixo]
    series_links = len(set(re.findall(r"novelupdates\.com/series/[a-z0-9\-]+", baixo)))
    print(f"--- {rotulo} ---")
    print(f"  status_http = {status}")
    print(f"  title       = {titulo!r}")
    print(f"  len(html)   = {len(html)}")
    print(f"  marcadores  = {marcadores}")
    print(f"  series_links= {series_links}")
    print(f"  html[:300]  = {html[:300].replace(chr(10), ' ')}")


def main():
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

        s_status, s_title, s_html = carregar(pagina, SERIE)
        diagnostico("SÉRIE", s_status, s_title, s_html)

        b_status, b_title, b_html = carregar(pagina, BUSCA)
        diagnostico("BUSCA", b_status, b_title, b_html)

        navegador.close()

    soup = BeautifulSoup(s_html, "html.parser")
    passou_serie = bool(
        soup.find("meta", attrs={"property": "og:url"}) and soup.find(id="editassociated")
    )
    print(f"\nVEREDITO_SERIE={'PASSOU' if passou_serie else 'FALHOU'}")
    sys.exit(0 if passou_serie else 1)


if __name__ == "__main__":
    main()
