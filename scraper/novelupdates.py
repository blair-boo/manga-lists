"""
Estágio "novelupdates" do scraper (Handout 3, Bloco E): para cada obra ainda
sem `novelupdates_url`, procura no Novel Updates uma página cujo título — ou um
dos Associated Names — case com o título/títulos alternativos da obra.

Decisão por score de título (rapidfuzz), com os limiares de
`configuracoes_scraper` (chave 'match_titulo' -> 'novelupdates'):
  - score >= auto_aprovacao  -> grava novelupdates_url direto na obra + enriquece
    Alternative titles (Associated Names romanos) + espelha na contraparte vinculada.
  - minimo <= score < auto   -> upsert em novelupdates_pendentes (fila de curadoria).
  - score < minimo           -> ignora (não é a obra).

Uso: python scraper/novelupdates.py
"""

import os
import re
import time
import traceback
import unicodedata

from bs4 import BeautifulSoup

from common import finalizar_run, get_supabase, iniciar_run
from match_titulo import melhor_match
from nu_browser import abrir_nu_browser

DELAY_ENTRE_REQUESTS = 1.5
MAX_CANDIDATOS = 5

# Scripts não-romanos a descartar ao enriquecer Alternative titles (Bloco E3):
# Hiragana/Katakana, extensão Kana, CJK (chinês/kanji) e Hangul (coreano).
NAO_ROMANO = re.compile(
    r"[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿ｦ-ﾟ]"
)


def eh_romano(s: str) -> bool:
    """True se a string não contém nenhum caractere CJK/Hangul/Kana (Bloco E3)."""
    return not NAO_ROMANO.search(s)


def slugify(s: str) -> str:
    """
    Reproduz o slug que o NU (WordPress sanitize_title) gera a partir do título:
    minúsculo, acentos viram ASCII, apóstrofos somem (não viram hífen), e qualquer
    outra sequência não-alfanumérica vira um hífen. "I Became the Lead's Friend"
    -> "i-became-the-leads-friend"; "Café au Lait" -> "cafe-au-lait".
    """
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    s = s.lower().replace("'", "").replace("’", "")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return re.sub(r"-+", "-", s).strip("-")


def candidatos_series(obra: dict) -> list[str]:
    """
    URLs de páginas /series/<slug>/ candidatas, derivadas do título e dos títulos
    alternativos da obra (dedupe, ordem preservada, teto de MAX_CANDIDATOS).

    O endpoint de BUSCA do NU (?s=) responde 403 a IPs de datacenter (confirmado
    na sonda: "Attention Required! | Cloudflare"), mas as PÁGINAS de série são
    servidas normalmente (200). Como o slug do NU é derivado do título, chutamos o
    slug e vamos direto à página — o match por og:title/Associated Names valida;
    slug errado cai em 404, pontua 0 e é ignorado.
    """
    fontes = [obra["titulo"], *(obra.get("titulos_alternativos") or [])]
    vistos: set[str] = set()
    urls: list[str] = []
    for titulo in fontes:
        slug = slugify(titulo)
        if not slug or slug in vistos:
            continue
        vistos.add(slug)
        urls.append(f"https://www.novelupdates.com/series/{slug}/")
        if len(urls) >= MAX_CANDIDATOS:
            break
    return urls


def _meta(soup: BeautifulSoup, prop: str) -> str | None:
    tag = soup.find("meta", attrs={"property": prop})
    if tag and tag.get("content"):
        return tag["content"].strip()
    return None


def extrair_dados_serie(html: str) -> tuple[str | None, str | None, list[str]]:
    """(og:title, og:url, Associated Names) de uma página de série do NU."""
    soup = BeautifulSoup(html, "html.parser")
    og_title = _meta(soup, "og:title")
    og_url = _meta(soup, "og:url")

    associados: list[str] = []
    assoc_div = soup.find(id="editassociated")
    if assoc_div:
        # As entradas ficam separadas por <br>; get_text("\n") transforma cada
        # <br> em quebra de linha, então basta separar por \n.
        for parte in assoc_div.get_text("\n").split("\n"):
            parte = parte.strip()
            if parte:
                associados.append(parte)
    return og_title, og_url, associados


def pontuar(obra: dict, og_title: str | None, associados: list[str]) -> float:
    """
    Melhor score entre (títulos da obra) x (og:title + Associated Names do NU).
    melhor_match já compara um candidato contra título + títulos alternativos da
    obra; aqui pegamos o melhor entre todas as strings do lado do NU (E2).
    """
    lados_nu = [s for s in ([og_title] + associados) if s]
    if not lados_nu:
        return 0.0
    return max(melhor_match(nu_str, obra) for nu_str in lados_nu)


def enriquecer_titulos(existentes: list[str] | None, associados: list[str]) -> list[str]:
    """
    União (sem duplicar, case-insensitive) dos títulos alternativos existentes com
    os Associated Names romanos (E3/E4). Preserva os existentes e a ordem de chegada.
    """
    resultado = list(existentes or [])
    ja = {t.strip().lower() for t in resultado}
    for nome in associados:
        nome = nome.strip()
        if not nome or not eh_romano(nome):
            continue
        chave = nome.lower()
        if chave not in ja:
            resultado.append(nome)
            ja.add(chave)
    return resultado


def carregar_limiares(supabase) -> dict:
    """Limiares da chave 'novelupdates' em configuracoes_scraper -> match_titulo (com default)."""
    default = {"limiar_auto_aprovacao": 0.95, "limiar_minimo_pendencia": 0.85}
    try:
        resp = supabase.table("configuracoes_scraper").select("valor").eq("chave", "match_titulo").execute()
    except Exception:  # noqa: BLE001 - tabela pode não existir; usa default
        return default
    if resp.data and isinstance(resp.data[0].get("valor"), dict):
        return resp.data[0]["valor"].get("novelupdates", default)
    return default


def aplicar_match_confirmado(supabase, obra: dict, novelupdates_url: str, associados: list[str]) -> None:
    """
    Auto-aprovação (E2/E4/E6): grava novelupdates_url + enriquece Alternative titles.
    Como o scraper escreve direto no Supabase (não passa por updateObra do front),
    espelha manualmente novelupdates_url e titulos_alternativos na contraparte.
    """
    novos_titulos = enriquecer_titulos(obra.get("titulos_alternativos"), associados)
    patch = {"novelupdates_url": novelupdates_url, "titulos_alternativos": novos_titulos or None}
    supabase.table("obras").update(patch).eq("id", obra["id"]).execute()

    vinculada_id = obra.get("obra_vinculada_id")
    if vinculada_id:
        # Espelha na contraparte: novelupdates_url (E6) + titulos_alternativos (campo espelhado).
        supabase.table("obras").update(patch).eq("id", vinculada_id).execute()


def upsert_pendente(supabase, obra_id: str, url: str, titulo_encontrado: str, score: float, associados: list[str]) -> None:
    """Insere/atualiza a pendência (unique por obra_id). Reabre como 'pendente'."""
    supabase.table("novelupdates_pendentes").upsert(
        {
            "obra_id": obra_id,
            "novelupdates_url": url,
            "titulo_encontrado": titulo_encontrado,
            "score": score,
            "titulos_associados": associados or None,
            "status_aprovacao": "pendente",
        },
        on_conflict="obra_id",
    ).execute()


def executar(supabase) -> dict:
    limiares = carregar_limiares(supabase)
    auto = limiares.get("limiar_auto_aprovacao", 0.95)
    minimo = limiares.get("limiar_minimo_pendencia", 0.85)

    obras = (
        supabase.table("obras")
        .select("id, titulo, titulos_alternativos, obra_vinculada_id, novelupdates_url")
        .is_("novelupdates_url", "null")
        .execute()
        .data
    )
    pendentes = supabase.table("novelupdates_pendentes").select("obra_id, novelupdates_url, status_aprovacao").execute().data
    reprovados = {p["obra_id"]: p["novelupdates_url"] for p in pendentes if p.get("status_aprovacao") == "reprovado"}

    # Batching opcional (Handout 4, 2.4): NU_LIMITE_OBRAS limita quantas obras por
    # run. Como o scraper já filtra por novelupdates_url IS NULL, cada run seguinte
    # pega só o que sobrou. Default: sem limite.
    limite = os.environ.get("NU_LIMITE_OBRAS")
    if limite and limite.isdigit():
        obras = obras[: int(limite)]

    # 'bloqueadas' (fetch devolveu None: challenge/403) é separado de 'ignoradas'
    # (busca ok, mas nenhuma série casou) — desfaz a ambiguidade do run anterior.
    contadores = {"auto": 0, "pendentes": 0, "ignoradas": 0, "bloqueadas": 0}

    # Guarda anti-desperdício: a sonda provou que o Cloudflare do NU serve só a 1ª
    # requisição e depois passa a devolver o managed challenge "Just a moment" (403)
    # que o Chromium headless não resolve a partir do IP do runner. Se as primeiras
    # obras vierem todas bloqueadas e nada casar, aborta cedo em vez de gastar o job
    # inteiro batendo em 403 — o acesso confiável exige proxy residencial / API
    # gerenciada (ver README). abortado vira a mensagem da run.
    ABORTAR_APOS_BLOQUEIOS = 15
    consecutivas_bloqueadas = 0
    abortado = False

    with abrir_nu_browser() as browser:
        for obra in obras:
            series = candidatos_series(obra)
            if not series:
                contadores["ignoradas"] += 1
                continue

            melhor = None  # (score, og_url, og_title, associados)
            algum_bloqueio = False
            houve_match = False
            for serie_url in series:
                time.sleep(DELAY_ENTRE_REQUESTS)
                html = browser.get_html(serie_url)
                if html is None:
                    algum_bloqueio = True
                    continue
                og_title, og_url, associados = extrair_dados_serie(html)
                if og_url is None:
                    continue  # 404/slug errado: página sem og:url, não é série
                houve_match = True
                score = pontuar(obra, og_title, associados)
                if melhor is None or score > melhor[0]:
                    melhor = (score, og_url, og_title or "", associados)

            if melhor is None:
                # Nenhum candidato virou página de série válida: distingue bloqueio de
                # acesso (raro aqui, série é servida) de ausência real (slug não existe).
                bloqueada = algum_bloqueio and not houve_match
                contadores["bloqueadas" if bloqueada else "ignoradas"] += 1
                consecutivas_bloqueadas = consecutivas_bloqueadas + 1 if bloqueada else 0
                if (
                    consecutivas_bloqueadas >= ABORTAR_APOS_BLOQUEIOS
                    and contadores["auto"] + contadores["pendentes"] == 0
                ):
                    abortado = True
                    print(
                        f"\nAbortando: {consecutivas_bloqueadas} obras seguidas bloqueadas pelo "
                        "Cloudflare e nenhuma casada. Acesso automático indisponível a partir "
                        "deste runner (ver README)."
                    )
                    break
                continue

            consecutivas_bloqueadas = 0

            score, url, titulo_encontrado, associados = melhor

            # Não reinserir uma URL já reprovada para a mesma obra (E5).
            if reprovados.get(obra["id"]) == url:
                contadores["ignoradas"] += 1
                continue

            if score >= auto:
                aplicar_match_confirmado(supabase, obra, url, associados)
                contadores["auto"] += 1
                print(f"  {obra['titulo']}: {score:.2f} AUTO -> {url}")
            elif score >= minimo:
                upsert_pendente(supabase, obra["id"], url, titulo_encontrado, score, associados)
                contadores["pendentes"] += 1
                print(f"  {obra['titulo']}: {score:.2f} pendente -> {url}")
            else:
                contadores["ignoradas"] += 1

    contadores["abortado"] = abortado
    print(
        f"\nConcluído. {contadores['auto']} auto-aprovada(s), "
        f"{contadores['pendentes']} pendente(s), {contadores['ignoradas']} ignorada(s), "
        f"{contadores['bloqueadas']} bloqueada(s)."
    )
    return contadores


def main():
    supabase = get_supabase()
    run_id = iniciar_run(supabase, "novelupdates")
    try:
        c = executar(supabase)
        prefixo = "Cloudflare bloqueou o acesso automático — " if c.get("abortado") else ""
        finalizar_run(
            supabase,
            run_id,
            "concluido",
            f"{prefixo}{c['auto']} auto, {c['pendentes']} pendente(s), {c['ignoradas']} ignorada(s), {c['bloqueadas']} bloqueada(s)",
            resumo={
                "auto": c["auto"],
                "pendentes": c["pendentes"],
                "ignoradas": c["ignoradas"],
                "bloqueadas": c["bloqueadas"],
            },
        )
    except Exception as exc:
        finalizar_run(supabase, run_id, "erro", f"{exc}\n{traceback.format_exc()}"[:2000])
        raise


if __name__ == "__main__":
    main()
