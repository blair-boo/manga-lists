"""
Estágio 1 do scraper: para cada fonte aprovada, busca o capítulo mais recente
disponível e recalcula `obras.ultimo_capitulo_lancado`.

Uso: python scraper/update_fontes.py
Requer SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente (ou scraper/.env local).
"""

import sys
from datetime import datetime, timezone

import requests

from common import HEADERS, extrair_maior_capitulo, get_supabase

TIMEOUT = 25


def buscar_html_fetch_direto(url: str) -> str:
    resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    resp.raise_for_status()
    return resp.text


def buscar_html_busca_workaround(url: str) -> str:
    """
    Sites com proteção anti-bot/JS (ex: nyxscans) não respondem a requests simples.
    Renderiza com Playwright headless antes de extrair o HTML final.
    """
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(user_agent=HEADERS["User-Agent"])
        page.goto(url, timeout=TIMEOUT * 1000, wait_until="networkidle")
        html = page.content()
        browser.close()
        return html


def main():
    supabase = get_supabase()

    sites = supabase.table("sites_suportados").select("nome, estrategia").execute().data
    estrategia_por_site = {s["nome"]: s["estrategia"] for s in sites}

    fontes = supabase.table("fontes").select("*").eq("status_aprovacao", "aprovado").execute().data
    print(f"{len(fontes)} fontes aprovadas para verificar.")

    capitulos_por_obra: dict[str, list[float]] = {}
    falhas = 0

    for fonte in fontes:
        estrategia = estrategia_por_site.get(fonte["site"], "fetch_direto")
        try:
            if estrategia == "busca_workaround":
                html = buscar_html_busca_workaround(fonte["url"])
            else:
                html = buscar_html_fetch_direto(fonte["url"])

            capitulo = extrair_maior_capitulo(html)
            agora = datetime.now(timezone.utc).isoformat()

            if capitulo is not None:
                supabase.table("fontes").update(
                    {"ultimo_capitulo_detectado": capitulo, "ultima_verificacao": agora}
                ).eq("id", fonte["id"]).execute()
                capitulos_por_obra.setdefault(fonte["obra_id"], []).append(capitulo)
                print(f"  ok: {fonte['url']} -> cap. {capitulo}")
            else:
                supabase.table("fontes").update({"ultima_verificacao": agora}).eq("id", fonte["id"]).execute()
                print(f"  aviso: não achei número de capítulo em {fonte['url']}")
                if fonte["ultimo_capitulo_detectado"] is not None:
                    capitulos_por_obra.setdefault(fonte["obra_id"], []).append(fonte["ultimo_capitulo_detectado"])

        except Exception as exc:  # noqa: BLE001 - uma fonte com erro não deve derrubar o resto do batch
            falhas += 1
            print(f"  falha ao verificar {fonte['url']}: {exc}", file=sys.stderr)
            if fonte["ultimo_capitulo_detectado"] is not None:
                capitulos_por_obra.setdefault(fonte["obra_id"], []).append(fonte["ultimo_capitulo_detectado"])

    print(f"\nRecalculando ultimo_capitulo_lancado de {len(capitulos_por_obra)} obras…")
    for obra_id, capitulos in capitulos_por_obra.items():
        maior = max(capitulos)
        supabase.table("obras").update({"ultimo_capitulo_lancado": maior}).eq("id", obra_id).execute()

    print(f"Concluído. {falhas} falha(s) de {len(fontes)} fontes.")


if __name__ == "__main__":
    main()
