"""
Estágio 1 do scraper: para cada fonte aprovada, busca o capítulo mais recente
disponível e recalcula `obras.ultimo_capitulo_lancado`.

Uso: python scraper/update_fontes.py
Requer SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente (ou scraper/.env local).
"""

import sys
import traceback
from datetime import datetime, timezone

import requests

from common import (
    HEADERS,
    TIMEOUT,
    buscar_ultimo_capitulo_nyxscans,
    eh_nyxscans,
    extrair_maior_capitulo,
    finalizar_run,
    get_supabase,
    iniciar_run,
    slug_de_url_nyxscans,
)


def obter_capitulo(url: str) -> float | None:
    """
    Descobre o último capítulo de uma fonte. nyxscans tem parser dedicado (uma
    requisição HTTP simples, lê o payload embutido do Next.js). Qualquer outro
    site cai na heurística genérica de extração de HTML.
    """
    if eh_nyxscans(url):
        slug = slug_de_url_nyxscans(url)
        if slug:
            return buscar_ultimo_capitulo_nyxscans(slug)
        # sem slug reconhecível: cai pro genérico abaixo

    resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    resp.raise_for_status()
    return extrair_maior_capitulo(resp.text)


def executar(supabase) -> int:
    """Retorna o número de falhas."""
    fontes = supabase.table("fontes").select("*").eq("status_aprovacao", "aprovado").execute().data
    print(f"{len(fontes)} fontes aprovadas para verificar.")

    # lista de (capitulo, veio_do_scraper) por obra, pra saber depois se o maior
    # valor de cada obra foi atualizado pelo scraper ou é um valor manual antigo.
    capitulos_por_obra: dict[str, list[tuple[float, bool]]] = {}
    falhas = 0

    for fonte in fontes:
        try:
            capitulo = obter_capitulo(fonte["url"])
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
                print(f"  ok: {fonte['url']} -> cap. {capitulo}")
            else:
                supabase.table("fontes").update({"ultima_verificacao": agora}).eq("id", fonte["id"]).execute()
                print(f"  aviso: não achei número de capítulo em {fonte['url']}")
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
