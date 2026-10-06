"""
Estágio "fontes" do scraper: descobre novas fontes para obras. Para cada site
suportado, busca pelo adaptador designado (quando o acesso é 'http'); os demais
sites caem no padrão genérico `?s=`. Em seguida faz uma busca web (DuckDuckGo) para
toda obra da biblioteca, ignorando domínios em `dominios_bloqueados`.

Opções por env (vindas do botão em Settings > Sources):
  FONTES_TIPOS         'manga' | 'novel' | vazio (todas)
  FONTES_WEB_DOMINIOS  'somente' | 'excluir' | vazio. Refere-se aos domínios
                       aprovados que não têm scraper de biblioteca (sem adaptador).

Status de cada fonte decidido pelo score de título (rapidfuzz) com os limiares de
`configuracoes_scraper` (chave 'match_titulo' -> 'buscar_novas_fontes').

Uso: python scraper/discover_fontes.py
"""

import os
import signal
import sys
import time
import traceback
from urllib.parse import parse_qs, quote, unquote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from adapters import ACCESS_HTTP, REGISTRY, resolver_access_strategy
from common import (
    buscar_todas,
    carregar_config_match,
    carregar_dominios_bloqueados,
    finalizar_run,
    get_supabase,
    http_get,
    iniciar_run,
)
from match_titulo import decidir_status, melhor_match
from tipo_titulo import familia_de_tipo, por_url

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


Resultado = tuple[str, float, str | None]  # (url, score, tipo_detectado)


def buscar_via_adapter(adapter, url_base: str, obra: dict) -> Resultado | None:
    """Melhor resultado da busca do adaptador (ex.: api/posts do CMS): (url, score, tipo) ou None."""
    familia_obra = familia_de_tipo(obra.get("tipo"))
    melhor_url = None
    melhor_score = 0.0
    melhor_tipo = None
    for titulo_resultado, slug in adapter.buscar(url_base, obra["titulo"]):
        candidato_url = adapter.url_da_fonte(url_base, slug)
        tipo_candidato = por_url(candidato_url)
        # Sinal de tipo diverge do tipo da obra: provável contraparte manga/novel, pula (B1/B0).
        if familia_obra is not None and tipo_candidato is not None and tipo_candidato != familia_obra:
            continue
        score = melhor_match(titulo_resultado, obra)
        if score > melhor_score:
            melhor_score = score
            melhor_url = candidato_url
            melhor_tipo = tipo_candidato
    return (melhor_url, melhor_score, melhor_tipo) if melhor_url else None


def buscar_no_site(site: dict, obra: dict) -> Resultado | None:
    """
    Busca interna no site. Se o domínio tem adaptador designado (e acesso 'http'),
    usa a busca do adaptador; senão cai no padrão genérico `?s=`. Retorna
    (url absoluta, score, tipo detectado) do melhor resultado, ou None.
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

    familia_obra = familia_de_tipo(obra.get("tipo"))
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
    melhor_tipo = None
    for a in soup.find_all("a", href=True):
        texto = a.get_text(strip=True)
        if not texto:
            continue
        href_abs = urljoin(url_base, a["href"])  # sempre absoluta
        tipo_candidato = por_url(href_abs)
        if familia_obra is not None and tipo_candidato is not None and tipo_candidato != familia_obra:
            continue
        score = melhor_match(texto, obra)
        if score > melhor_score:
            melhor_score = score
            melhor_url = href_abs
            melhor_tipo = tipo_candidato
    return (melhor_url, melhor_score, melhor_tipo) if melhor_url else None


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


TAMANHO_LOTE_SITE_QUERY = 5

MODO_WEB_SOMENTE = "somente"
MODO_WEB_EXCLUIR = "excluir"


def parse_tipos(valor: str | None) -> set[str] | None:
    """
    `FONTES_TIPOS` (ex.: 'manga', 'novel' ou 'manga,novel') -> famílias a buscar.
    Vazio, desconhecido ou as duas famílias = None (sem filtro, biblioteca inteira).
    """
    tipos = {t.strip().lower() for t in (valor or "").split(",")} & {"manga", "novel"}
    return tipos if tipos and len(tipos) < 2 else None


def parse_modo_web(valor: str | None) -> str | None:
    """`FONTES_WEB_DOMINIOS`: 'somente' | 'excluir' | vazio (busca geral)."""
    v = (valor or "").strip().lower()
    return v if v in (MODO_WEB_SOMENTE, MODO_WEB_EXCLUIR) else None


def dominio_em(host: str, dominios: set[str]) -> bool:
    """True se `host` é um dos domínios ou um subdomínio deles."""
    return any(host == d or host.endswith("." + d) for d in dominios)


def montar_queries_web(obra: dict, modo: str | None, dominios_sem_adapter: set[str]) -> list[str]:
    """
    Queries DuckDuckGo da obra. Modo 'somente' restringe a `site:` dos domínios
    aprovados sem scraper de biblioteca, em lotes pequenos; os demais modos usam
    uma query geral ('novel' para novels, 'manga' para o resto).
    """
    termo = "novel" if familia_de_tipo(obra.get("tipo")) == "novel" else "manga"
    base = f"{obra['titulo']} {termo} read online"
    if modo != MODO_WEB_SOMENTE:
        return [base]
    dominios = sorted(dominios_sem_adapter)
    return [
        f"{obra['titulo']} (" + " OR ".join(f"site:{d}" for d in dominios[i : i + TAMANHO_LOTE_SITE_QUERY]) + ")"
        for i in range(0, len(dominios), TAMANHO_LOTE_SITE_QUERY)
    ]


def buscar_fallback_web(
    obra: dict,
    dominios_bloqueados: set[str],
    modo: str | None = None,
    dominios_sem_adapter: frozenset[str] | set[str] = frozenset(),
    urls_existentes: set[str] | None = None,
) -> Resultado | None:
    """
    Busca web (DuckDuckGo HTML). Ignora blacklist, domínios não-agregadores e URLs
    que a biblioteca já tem. modo 'somente': só domínios aprovados sem scraper;
    modo 'excluir': descarta esses domínios; None: busca geral.
    """
    familia_obra = familia_de_tipo(obra.get("tipo"))
    dominios_sem_adapter = set(dominios_sem_adapter)
    if modo == MODO_WEB_SOMENTE and not dominios_sem_adapter:
        return None
    melhor_url = None
    melhor_score = 0.0
    melhor_tipo = None
    for query in montar_queries_web(obra, modo, dominios_sem_adapter):
        try:
            resp = http_get(f"https://html.duckduckgo.com/html/?q={quote(query)}")
            resp.raise_for_status()
        except requests.RequestException as exc:
            print(f"    busca web falhou: {exc}", file=sys.stderr)
            continue

        soup = BeautifulSoup(resp.text, "lxml")
        for a in soup.select("a.result__a"):
            href = _resolver_href_ddg(a.get("href") or "")
            host = dominio_de_url(href)
            if not href or dominio_em(host, dominios_bloqueados):
                continue
            if urls_existentes and href in urls_existentes:
                continue
            if modo == MODO_WEB_SOMENTE and not dominio_em(host, dominios_sem_adapter):
                continue
            if modo == MODO_WEB_EXCLUIR and dominio_em(host, dominios_sem_adapter):
                continue
            if not any(p in href.lower() for p in PALAVRAS_CHAVE_AGREGADOR):
                continue
            tipo_candidato = por_url(href)
            if familia_obra is not None and tipo_candidato is not None and tipo_candidato != familia_obra:
                continue
            score = melhor_match(a.get_text(strip=True), obra)
            if score > melhor_score:
                melhor_score = score
                melhor_url = href
                melhor_tipo = tipo_candidato
    return (melhor_url, melhor_score, melhor_tipo) if melhor_url else None


TAMANHO_LOTE_INSERT = 25


def executar(supabase, tipos: set[str] | None = None, modo_web: str | None = None) -> int:
    """
    Retorna o número de novas fontes descobertas. `tipos`: famílias a buscar
    (None = biblioteca inteira). `modo_web`: ver `buscar_fallback_web`.
    """
    config = carregar_config_match(supabase)
    limiares = config.get(
        "buscar_novas_fontes", {"limiar_auto_aprovacao": 0.95, "limiar_minimo_pendencia": 0.85}
    )
    dominios_bloqueados = carregar_dominios_bloqueados(supabase)

    # Paginado (ver buscar_todas): `fontes` passa de 1000 linhas, e um corte
    # silencioso faria a descoberta propor fonte pra obra que já tem uma.
    obras = buscar_todas(
        lambda: supabase.table("obras").select("id, titulo, titulos_alternativos, tipo").order("id")
    )
    if tipos:
        obras = [o for o in obras if familia_de_tipo(o.get("tipo")) in tipos]
    fontes_existentes = buscar_todas(lambda: supabase.table("fontes").select("obra_id, site, url").order("id"))
    sites = buscar_todas(
        lambda: supabase.table("sites_suportados")
        .select("nome, url_base, ativo, adaptador, access_strategy")
        .eq("ativo", True)
        .order("nome")
    )

    # Domínios aprovados sem scraper de biblioteca (sem adaptador): alvo/exclusão do modo web.
    dominios_sem_adapter = {
        d for d in (dominio_de_url(s_["url_base"]) for s_ in sites if not s_.get("adaptador")) if d
    }

    sites_por_obra: dict[str, set[str]] = {}
    urls_por_obra: dict[str, set[str]] = {}
    for f in fontes_existentes:
        sites_por_obra.setdefault(f["obra_id"], set()).add(f["site"])
        if f.get("url"):
            urls_por_obra.setdefault(f["obra_id"], set()).add(f["url"])

    novas_fontes: list[dict] = []
    total_inseridas = 0

    def descarregar(forcar: bool = False) -> None:
        """Grava em lotes (um crash no meio não perde tudo o que já foi achado)."""
        nonlocal total_inseridas
        if novas_fontes and (forcar or len(novas_fontes) >= TAMANHO_LOTE_INSERT):
            supabase.table("fontes").insert(novas_fontes).execute()
            total_inseridas += len(novas_fontes)
            novas_fontes.clear()

    def registrar(obra_id: str, site_nome: str | None, url: str, score: float, tipo_detectado: str | None) -> bool:
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
                "tipo_detectado": tipo_detectado,
            }
        )
        return True

    for obra in obras:
        ja_tem = sites_por_obra.get(obra["id"], set())
        urls_obra = urls_por_obra.get(obra["id"], set())

        for site in sites:
            if site["nome"] in ja_tem:
                continue
            time.sleep(DELAY_ENTRE_REQUESTS)
            resultado = buscar_no_site(site, obra)
            if resultado and registrar(obra["id"], site["nome"], resultado[0], resultado[1], resultado[2]):
                print(f"  {obra['titulo']}: {site['nome']} {resultado[1]:.2f} -> {resultado[0]}")
                urls_obra.add(resultado[0])

        # Busca web para toda obra (não só as sem fonte). O nome exibido é o
        # domínio (ex.: 'coolscans.net'), não o link inteiro (handout consolidado A6).
        time.sleep(DELAY_ENTRE_REQUESTS)
        resultado = buscar_fallback_web(obra, dominios_bloqueados, modo_web, dominios_sem_adapter, urls_obra)
        if resultado:
            nome_dominio = dominio_de_url(resultado[0]) or None
            if nome_dominio not in ja_tem and registrar(
                obra["id"], nome_dominio, resultado[0], resultado[1], resultado[2]
            ):
                print(f"  {obra['titulo']}: web {resultado[1]:.2f} -> {resultado[0]}")
        descarregar()

    descarregar(forcar=True)
    print(f"\n{total_inseridas} nova(s) fonte(s) inserida(s) (aprovadas ou pendentes).")
    return total_inseridas


def _ao_receber_sigterm(signum, _frame):
    # O cancelamento do GitHub Actions manda SIGTERM: vira SystemExit pra o
    # `except BaseException` de main() ainda gravar o status final da run.
    raise SystemExit(f"interrompido (sinal {signum})")


def main():
    signal.signal(signal.SIGTERM, _ao_receber_sigterm)
    supabase = get_supabase()
    run_id = iniciar_run(supabase, "fontes")
    tipos = parse_tipos(os.environ.get("FONTES_TIPOS"))
    modo_web = parse_modo_web(os.environ.get("FONTES_WEB_DOMINIOS"))
    try:
        quantidade = executar(supabase, tipos, modo_web)
        finalizar_run(
            supabase,
            run_id,
            "concluido",
            f"{quantidade} nova(s) fonte(s) encontrada(s)",
            resumo={"fontes_novas": quantidade},
        )
    except BaseException as exc:  # noqa: BLE001 - inclui SystemExit/KeyboardInterrupt: a run nunca fica 'rodando'
        finalizar_run(supabase, run_id, "erro", f"{exc!r}\n{traceback.format_exc()}"[:2000])
        raise


if __name__ == "__main__":
    main()
