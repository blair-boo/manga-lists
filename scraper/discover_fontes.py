"""
Estágio "fontes" do scraper: descobre novas fontes para obras. Primeiro varre
`sites_suportados` ativos (busca interna no site), depois cai num fallback de
busca web genérica (DuckDuckGo), ignorando domínios em `dominios_bloqueados`.

O status de cada fonte encontrada é decidido pelo score de similaridade de
título (rapidfuzz), usando os limiares de `configuracoes_scraper`
(chave 'match_titulo' → 'buscar_novas_fontes'):
  score >= limiar_auto_aprovacao   -> entra 'aprovado'
  score >= limiar_minimo_pendencia -> entra 'pendente' (fila de revisão)
  abaixo disso                     -> descartada (nem registra)

Uso: python scraper/discover_fontes.py
Requer SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente (ou scraper/.env local).
"""

import sys
import time
import traceback
from urllib.parse import quote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from common import (
    HEADERS,
    buscar_candidatos_nyxscans,
    carregar_config_match,
    carregar_dominios_bloqueados,
    finalizar_run,
    get_supabase,
    iniciar_run,
)
from match_titulo import decidir_status, melhor_match

TIMEOUT = 20
DELAY_ENTRE_REQUESTS = 1.5

PALAVRAS_CHAVE_AGREGADOR = (
    "manga", "manhwa", "manhua", "novel", "scan", "read", "comic", "toon",
)


def dominio_de_url(url: str) -> str:
    """Host de uma URL, sem 'www.' e em minúsculas. Vazio se inválida."""
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def buscar_nyxscans(obra: dict) -> tuple[str, float] | None:
    """Melhor resultado no nyxscans (API de busca) para a obra: (url, score) ou None."""
    melhor_url = None
    melhor_score = 0.0
    for titulo_resultado, slug in buscar_candidatos_nyxscans(obra["titulo"]):
        score = melhor_match(titulo_resultado, obra)
        if score > melhor_score:
            melhor_score = score
            melhor_url = f"https://nyxscans.com/series/{slug}"
    return (melhor_url, melhor_score) if melhor_url else None


def buscar_no_site(url_base: str, obra: dict) -> tuple[str, float] | None:
    """
    Busca interna no site. nyxscans usa a API dedicada; os demais caem no padrão
    genérico `?s=` (comum em temas WordPress tipo Madara). Retorna (url, score) do
    resultado mais parecido com o título, ou None.
    """
    if "nyxscans" in url_base:
        return buscar_nyxscans(obra)

    busca_url = urljoin(url_base, f"/?s={quote(obra['titulo'])}")
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
        score = melhor_match(texto, obra)
        if score > melhor_score:
            melhor_score = score
            melhor_url = a["href"]
    return (melhor_url, melhor_score) if melhor_url else None


def buscar_fallback_web(obra: dict, dominios_bloqueados: set[str]) -> tuple[str, float] | None:
    """
    Fallback de busca web (DuckDuckGo HTML, sem API key). Ignora domínios em
    blacklist e só considera resultados em domínios que parecem agregadores.
    Retorna (url, score) do melhor, ou None.
    """
    query = quote(f"{obra['titulo']} manga read online")
    try:
        resp = requests.get(
            f"https://html.duckduckgo.com/html/?q={query}", headers=HEADERS, timeout=TIMEOUT
        )
        resp.raise_for_status()
    except requests.RequestException as exc:
        print(f"    busca web falhou: {exc}", file=sys.stderr)
        return None

    soup = BeautifulSoup(resp.text, "lxml")
    melhor_url = None
    melhor_score = 0.0
    for a in soup.select("a.result__a"):
        href = a.get("href") or ""
        if dominio_de_url(href) in dominios_bloqueados:
            continue
        if not any(p in href.lower() for p in PALAVRAS_CHAVE_AGREGADOR):
            continue
        score = melhor_match(a.get_text(strip=True), obra)
        if score > melhor_score:
            melhor_score = score
            melhor_url = href
    return (melhor_url, melhor_score) if melhor_url else None


def executar(supabase) -> int:
    """Retorna o número de novas fontes descobertas."""
    config = carregar_config_match(supabase)
    limiares = config.get(
        "buscar_novas_fontes", {"limiar_auto_aprovacao": 0.95, "limiar_minimo_pendencia": 0.85}
    )
    dominios_bloqueados = carregar_dominios_bloqueados(supabase)

    obras = supabase.table("obras").select("id, titulo, titulos_alternativos").execute().data
    fontes_existentes = supabase.table("fontes").select("obra_id, site").execute().data
    sites = supabase.table("sites_suportados").select("nome, url_base, ativo").eq("ativo", True).execute().data

    sites_por_obra: dict[str, set[str]] = {}
    for f in fontes_existentes:
        sites_por_obra.setdefault(f["obra_id"], set()).add(f["site"])

    novas_fontes = []

    def registrar(obra_id: str, site_nome: str | None, url: str, score: float) -> bool:
        status = decidir_status(score, limiares)
        if status is None:
            return False
        novas_fontes.append(
            {
                "obra_id": obra_id,
                "site": site_nome,
                "url": url,
                "ultimo_capitulo_detectado": None,
                "confiavel": True,
                "status_aprovacao": status,
                "descoberta_automaticamente": True,
                "ultima_verificacao": None,
            }
        )
        return True

    for obra in obras:
        ja_tem = sites_por_obra.get(obra["id"], set())
        encontrou_em_site_fixo = False

        for site in sites:
            if site["nome"] in ja_tem:
                continue
            time.sleep(DELAY_ENTRE_REQUESTS)
            resultado = buscar_no_site(site["url_base"], obra)
            if resultado and registrar(obra["id"], site["nome"], resultado[0], resultado[1]):
                print(f"  {obra['titulo']}: {site['nome']} {resultado[1]:.2f} -> {resultado[0]}")
                encontrou_em_site_fixo = True

        if encontrou_em_site_fixo or ja_tem:
            continue

        # Nenhuma fonte em nenhum site fixo: fallback de busca web
        time.sleep(DELAY_ENTRE_REQUESTS)
        resultado = buscar_fallback_web(obra, dominios_bloqueados)
        if resultado and registrar(obra["id"], None, resultado[0], resultado[1]):
            print(f"  {obra['titulo']}: web {resultado[1]:.2f} -> {resultado[0]}")

    if novas_fontes:
        supabase.table("fontes").insert(novas_fontes).execute()
    print(f"\n{len(novas_fontes)} nova(s) fonte(s) inserida(s) (aprovadas ou pendentes).")
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
