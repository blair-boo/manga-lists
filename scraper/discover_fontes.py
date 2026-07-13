"""
Estágio 2 do scraper: descobre novas fontes para obras que ainda não têm uma
fonte cadastrada num dado site. Primeiro varre `sites_suportados` ativos
(busca interna no site), depois cai num fallback de busca web genérica.

Toda fonte encontrada entra em `fontes` com status_aprovacao='pendente' e
descoberta_automaticamente=true — só passa a contar pra
`ultimo_capitulo_lancado` depois que a usuária aprovar no app.

Uso: python scraper/discover_fontes.py
Requer SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente (ou scraper/.env local).
"""

import sys
import time
import traceback
from difflib import SequenceMatcher
from urllib.parse import quote, urljoin

import requests
from bs4 import BeautifulSoup

from common import HEADERS, finalizar_run, get_supabase, iniciar_run

TIMEOUT = 20
DELAY_ENTRE_REQUESTS = 1.5
LIMIAR_SIMILARIDADE = 0.72

PALAVRAS_CHAVE_AGREGADOR = (
    "manga", "manhwa", "manhua", "novel", "scan", "read", "comic", "toon",
)


def similaridade(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def buscar_no_site(url_base: str, titulo: str) -> str | None:
    """
    Busca interna genérica no padrão `?s=` (comum em temas WordPress tipo Madara,
    usado por vários agregadores de manga). Retorna a URL do resultado mais
    parecido com o título, se a similaridade passar do limiar.
    """
    busca_url = urljoin(url_base, f"/?s={quote(titulo)}")
    try:
        resp = requests.get(busca_url, headers=HEADERS, timeout=TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as exc:
        print(f"    busca em {url_base} falhou: {exc}", file=sys.stderr)
        return None

    soup = BeautifulSoup(resp.text, "lxml")
    melhor_url = None
    melhor_score = 0.0
    for a in soup.find_all("a", href=True):
        texto = a.get_text(strip=True)
        if not texto:
            continue
        score = similaridade(texto, titulo)
        if score > melhor_score:
            melhor_score = score
            melhor_url = a["href"]

    if melhor_score >= LIMIAR_SIMILARIDADE:
        return melhor_url
    return None


def buscar_fallback_web(titulo: str) -> str | None:
    """Fallback de busca web (DuckDuckGo HTML, sem necessidade de API key)."""
    query = quote(f"{titulo} manga read online")
    try:
        resp = requests.get(
            f"https://html.duckduckgo.com/html/?q={query}", headers=HEADERS, timeout=TIMEOUT
        )
        resp.raise_for_status()
    except requests.RequestException as exc:
        print(f"    busca web falhou: {exc}", file=sys.stderr)
        return None

    soup = BeautifulSoup(resp.text, "lxml")
    for a in soup.select("a.result__a"):
        href = a.get("href") or ""
        texto = a.get_text(strip=True)
        dominio_relevante = any(p in href.lower() for p in PALAVRAS_CHAVE_AGREGADOR)
        if dominio_relevante and similaridade(texto, titulo) >= LIMIAR_SIMILARIDADE - 0.15:
            return href
    return None


def executar(supabase) -> int:
    """Retorna o número de novas fontes descobertas."""
    obras = supabase.table("obras").select("id, titulo").execute().data
    fontes_existentes = supabase.table("fontes").select("obra_id, site").execute().data
    sites = supabase.table("sites_suportados").select("nome, url_base, ativo").eq("ativo", True).execute().data

    sites_por_obra: dict[str, set[str]] = {}
    for f in fontes_existentes:
        sites_por_obra.setdefault(f["obra_id"], set()).add(f["site"])

    novas_fontes = []

    for obra in obras:
        ja_tem = sites_por_obra.get(obra["id"], set())
        encontrou_em_site_fixo = False

        for site in sites:
            if site["nome"] in ja_tem:
                continue
            time.sleep(DELAY_ENTRE_REQUESTS)
            url_encontrada = buscar_no_site(site["url_base"], obra["titulo"])
            if url_encontrada:
                print(f"  {obra['titulo']}: achei em {site['nome']} -> {url_encontrada}")
                novas_fontes.append(
                    {
                        "obra_id": obra["id"],
                        "site": site["nome"],
                        "url": url_encontrada,
                        "ultimo_capitulo_detectado": None,
                        "confiavel": True,
                        "status_aprovacao": "pendente",
                        "descoberta_automaticamente": True,
                        "ultima_verificacao": None,
                    }
                )
                encontrou_em_site_fixo = True

        if encontrou_em_site_fixo or ja_tem:
            continue

        # Nenhuma fonte em nenhum site fixo: fallback de busca web
        time.sleep(DELAY_ENTRE_REQUESTS)
        url_fallback = buscar_fallback_web(obra["titulo"])
        if url_fallback:
            print(f"  {obra['titulo']}: achei via busca web -> {url_fallback}")
            novas_fontes.append(
                {
                    "obra_id": obra["id"],
                    "site": None,
                    "url": url_fallback,
                    "ultimo_capitulo_detectado": None,
                    "confiavel": True,
                    "status_aprovacao": "pendente",
                    "descoberta_automaticamente": True,
                    "ultima_verificacao": None,
                }
            )

    if novas_fontes:
        supabase.table("fontes").insert(novas_fontes).execute()
    print(f"\n{len(novas_fontes)} nova(s) fonte(s) pendente(s) de aprovação inserida(s).")
    return len(novas_fontes)


def main():
    supabase = get_supabase()
    run_id = iniciar_run(supabase, "fontes")
    try:
        quantidade = executar(supabase)
        finalizar_run(supabase, run_id, "concluido", f"{quantidade} nova(s) fonte(s) encontrada(s)")
    except Exception as exc:
        finalizar_run(supabase, run_id, "erro", f"{exc}\n{traceback.format_exc()}"[:2000])
        raise


if __name__ == "__main__":
    main()
