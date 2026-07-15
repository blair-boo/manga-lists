"""
Estágio "capítulos" do scraper: para cada fonte aprovada, busca o capítulo mais
recente disponível e recalcula `obras.ultimo_capitulo_lancado`.

Roteia cada fonte pelo adaptador designado ao seu domínio (sites_suportados),
resolvendo a estratégia de acesso (domínio > padrão do adaptador). Domínios sem
adaptador caem na heurística genérica de HTML.

Uso: python scraper/update_fontes.py
Requer SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente (ou scraper/.env local).
"""

import sys
import traceback
from datetime import datetime, timezone

from adapters import REGISTRY, STATUS_OK, carregar_designacoes, resolver_access_strategy
from common import (
    SITES_NEXTJS_CMS,
    extrair_maior_capitulo,
    finalizar_run,
    get_supabase,
    host_de_url,
    http_get,
    iniciar_run,
    resolver_url,
)


def obter_capitulo(url: str, designacoes: dict) -> float | None:
    """
    Último capítulo de uma fonte (URL já absoluta). Se o domínio tem adaptador
    designado, usa-o com a estratégia de acesso resolvida; senão cai na heurística
    genérica de HTML. Retornos que não são capítulo (vazio/bloqueado/inválido) não
    são exceção — apenas devolvem None (não contam como falha).
    """
    desig = designacoes.get(host_de_url(url)) or {}
    adaptador_id = desig.get("adaptador")
    if adaptador_id:
        adapter = REGISTRY.por_id(adaptador_id)
        if adapter is not None:
            estrategia = resolver_access_strategy(desig.get("access_strategy"), adapter)
            resultado = adapter.parse(adapter.fetch(url, estrategia))
            return resultado.ultimo_capitulo if resultado.status == STATUS_OK else None

    resp = http_get(url)
    resp.raise_for_status()
    return extrair_maior_capitulo(resp.text)


def executar(supabase) -> int:
    """Retorna o número de falhas."""
    fontes = supabase.table("fontes").select("*").eq("status_aprovacao", "aprovado").execute().data
    print(f"{len(fontes)} fontes aprovadas para verificar.")

    designacoes = carregar_designacoes(supabase)

    # Base por site, para resolver fontes salvas com URL relativa (ex.: '/series/x').
    sites = supabase.table("sites_suportados").select("nome, url_base").execute().data
    base_por_site = {s["nome"]: s.get("url_base") for s in sites}
    for nome, cfg in SITES_NEXTJS_CMS.items():
        base_por_site.setdefault(nome, cfg["site"])

    # lista de (capitulo, veio_do_scraper) por obra, pra saber depois se o maior
    # valor de cada obra foi atualizado pelo scraper ou é um valor manual antigo.
    capitulos_por_obra: dict[str, list[tuple[float, bool]]] = {}
    falhas = 0

    for fonte in fontes:
        try:
            url = resolver_url(fonte["url"], base_por_site.get(fonte.get("site")))
            capitulo = obter_capitulo(url, designacoes)
            agora = datetime.now(timezone.utc).isoformat()

            if capitulo is not None:
                supabase.table("fontes").update(
                    {
                        "ultimo_capitulo_detectado": capitulo,
                        "atualizado_por_scraper": True,
                        "ultima_verificacao": agora,
                    }
                ).eq("id", fonte["id"]).execute()
                capitulos_por_obra.setdefault(fonte["obra_id"], []).append((capitulo, True))
                print(f"  ok: {url} -> cap. {capitulo}")
            else:
                supabase.table("fontes").update({"ultima_verificacao": agora}).eq("id", fonte["id"]).execute()
                print(f"  aviso: não achei número de capítulo em {url}")
                if fonte["ultimo_capitulo_detectado"] is not None:
                    capitulos_por_obra.setdefault(fonte["obra_id"], []).append(
                        (fonte["ultimo_capitulo_detectado"], fonte["atualizado_por_scraper"])
                    )

        except Exception as exc:  # noqa: BLE001 - uma fonte com erro não deve derrubar o resto do batch
            falhas += 1
            print(f"  falha ao verificar {fonte['url']}: {exc}", file=sys.stderr)
            # Registra a tentativa mesmo com erro, pra usuária ver no app quando foi a última vez
            # que o scraper tentou (e não conseguiu) verificar essa fonte.
            supabase.table("fontes").update(
                {"ultima_verificacao": datetime.now(timezone.utc).isoformat()}
            ).eq("id", fonte["id"]).execute()
            if fonte["ultimo_capitulo_detectado"] is not None:
                capitulos_por_obra.setdefault(fonte["obra_id"], []).append(
                    (fonte["ultimo_capitulo_detectado"], fonte["atualizado_por_scraper"])
                )

    print(f"\nRecalculando ultimo_capitulo_lancado de {len(capitulos_por_obra)} obras…")
    for obra_id, capitulos in capitulos_por_obra.items():
        maior = max(c for c, _ in capitulos)
        via_scraper = any(c == maior and origem for c, origem in capitulos)
        supabase.table("obras").update(
            {"ultimo_capitulo_lancado": maior, "ultimo_capitulo_via_scraper": via_scraper}
        ).eq("id", obra_id).execute()

    print(f"Concluído. {falhas} falha(s) de {len(fontes)} fontes.")
    return falhas


def main():
    supabase = get_supabase()
    run_id = iniciar_run(supabase, "capitulos")
    try:
        falhas = executar(supabase)
        status = "concluido" if falhas == 0 else "erro"
        mensagem = None if falhas == 0 else f"{falhas} fonte(s) falharam ao verificar"
        finalizar_run(supabase, run_id, status, mensagem)
    except Exception as exc:
        finalizar_run(supabase, run_id, "erro", f"{exc}\n{traceback.format_exc()}"[:2000])
        raise


if __name__ == "__main__":
    main()
