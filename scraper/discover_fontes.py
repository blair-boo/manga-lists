"""
Estágio "fontes" do scraper: descobre novas fontes para obras. Para cada site
suportado, busca pelo adaptador designado (quando o acesso é 'http'); os demais
sites caem no padrão genérico `?s=`. Sem resultado nos sites, tenta um fallback
de busca web (DuckDuckGo), ignorando domínios em `dominios_bloqueados`.

Status de cada fonte decidido pelo score de título (rapidfuzz) com os limiares de
`configuracoes_scraper` (chave 'match_titulo' -> 'buscar_novas_fontes').

Uso: python scraper/discover_fontes.py
"""

import sys
import time
import traceback
from urllib.parse import parse_qs, quote, unquote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from adapters import ACCESS_HTTP, REGISTRY, resolver_access_strategy
from common import (
    carregar_config_match,
    carregar_dominios_bloqueados,
    finalizar_run,
    get_supabase,
    http_get,
    iniciar_run,
)
from match_titulo import decidir_status, melhor_match

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


def buscar_via_adapter(adapter, url_base: str, obra: dict) -> tuple[str, float] | None:
    """Melhor resultado da busca do adaptador (ex.: api/posts do CMS): (url, score) ou None."""
    melhor_url = None
    melhor_score = 0.0
    for titulo_resultado, slug in adapter.buscar(url_base, obra["titulo"]):
        score = melhor_match(titulo_resultado, obra)
        if score > melhor_score:
            melhor_score = score
            melhor_url = adapter.url_da_fonte(url_base, slug)
    return (melhor_url, melhor_score) if melhor_url else None


def buscar_no_site(site: dict, obra: dict) -> tuple[str, float] | None:
    """
    Busca interna no site. Se o domínio tem adaptador designado (e acesso 'http'),
    usa a busca do adaptador; senão cai no padrão genérico `?s=`. Retorna
    (url absoluta, score) do melhor resultado, ou None.
    """
    url_base = site["url_base"]
    adaptador_id = site.get("adaptador")
    if adaptador_id:
        adapter = REGISTRY.por_id(adaptador_id)
        if adapter is not None and hasattr(adapter, "buscar"):
            estrategia = resolver_access_strategy(site.get("access_strategy"), adapter)
            if estrategia != ACCESS_HTTP:
                return None  # acesso ainda não disponível (ex.: flaresolverr)
            return buscar_via_adapter(adapter, url_base, obra)

    busca_url = urljoin(url_base, f"/?s={quote(obra['titulo'])}")
    try:
        resp = http_get(busca_url)
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
            melhor_url = urljoin(url_base, a["href"])  # sempre absoluta
    return (melhor_url, melhor_score) if melhor_url else None


def _resolver_href_ddg(href: str) -> str:
    """Extrai a URL real de um link de resultado do DuckDuckGo (redirect //duckduckgo.com/l/?uddg=)."""
    if href.startswith("//"):
        href = "https:" + href
    p = urlparse(href)
    if "duckduckgo.com" in (p.hostname or "") and p.path.startswith("/l/"):
        alvo = parse_qs(p.query).get("uddg")
        if alvo:
            return unquote(alvo[0])
    return href


def buscar_fallback_web(obra: dict, dominios_bloqueados: set[str]) -> tuple[str, float] | None:
    """Fallback de busca web (DuckDuckGo HTML). Ignora blacklist e domínios não-agregadores."""
    query = quote(f"{obra['titulo']} manga read online")
    try:
        resp = http_get(f"https://html.duckduckgo.com/html/?q={query}")
        resp.raise_for_status()
    except requests.RequestException as exc:
        print(f"    busca web falhou: {exc}", file=sys.stderr)
        return None

    soup = BeautifulSoup(resp.text, "lxml")
    melhor_url = None
    melhor_score = 0.0
    for a in soup.select("a.result__a"):
        href = _resolver_href_ddg(a.get("href") or "")
        if not href or dominio_de_url(href) in dominios_bloqueados:
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
    sites = (
        supabase.table("sites_suportados")
        .select("nome, url_base, ativo, adaptador, access_strategy")
        .eq("ativo", True)
        .execute()
        .data
    )

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
            resultado = buscar_no_site(site, obra)
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
