"""
Sonda de acesso ao Novel Updates via Playwright (Handout 4, Fase 1).
NÃO faz parte do scraper de produção — serve só pra confirmar se o runner
consegue passar pelo Cloudflare do NU antes de investir na conversão completa.

Uso: python scraper/probe_novelupdates.py
Sai 0 se obteve HTML real; 1 se bloqueado/indefinido.
"""

import sys

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

ALVO = "https://www.novelupdates.com/series/unbeknownst-to-me-i-am-secretly-dating-the-emperor/"
MARCADORES_CHALLENGE = (
    "just a moment",
    "cf-challenge",
    "challenge-platform",
    "attention required",
    "cf-turnstile",
)


def classificar(status_http, html):
    baixo = html.lower()
    if status_http in (403, 429) or "error 1020" in baixo:
        return "BLOQUEADO_403"
    if any(m in baixo for m in MARCADORES_CHALLENGE) and "og:url" not in baixo:
        return "BLOQUEADO_CHALLENGE"
    soup = BeautifulSoup(html, "html.parser")
    og_url = soup.find("meta", attrs={"property": "og:url"})
    assoc = soup.find(id="editassociated")
    if og_url and assoc:
        return "PASSOU"
    return "INDEFINIDO"


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
        resposta = pagina.goto(ALVO, wait_until="domcontentloaded", timeout=60000)
        status_http = resposta.status if resposta else None

        # Espera o desafio resolver: título deixa de ser "Just a moment" OU aparece og:url.
        try:
            pagina.wait_for_function(
                """() => !document.title.toLowerCase().includes('just a moment')
                         || !!document.querySelector('meta[property="og:url"]')""",
                timeout=40000,
            )
        except Exception:
            pass  # segue e classifica pelo que tiver

        html = pagina.content()
        navegador.close()

    veredito = classificar(status_http, html)
    print(f"STATUS_HTTP={status_http}")
    print(f"VEREDITO={veredito}")

    if veredito == "PASSOU":
        soup = BeautifulSoup(html, "html.parser")
        print("og:url =", soup.find("meta", attrs={"property": "og:url"}).get("content"))
        assoc = soup.find(id="editassociated")
        nomes = [t.strip() for t in assoc.get_text("\n").split("\n") if t.strip()][:5]
        print("Associated Names (amostra):", nomes)
    else:
        print("HTML (início):", html[:500].replace("\n", " "))

    sys.exit(0 if veredito == "PASSOU" else 1)


if __name__ == "__main__":
    main()
