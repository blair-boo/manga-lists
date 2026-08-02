"""
Importa um export local do catálogo do comix.to (gerado pelo userscript
`scraper/comix_library_export.user.js`, rodado no navegador do usuário — ver
docs/SCRAPING_API_COMIX.md) e casa com as obras cadastradas, do mesmo jeito
que `update_obras.processar_site` faria se o catálogo estivesse acessível ao
servidor.

Por que existe: o catálogo do comix (`/api/v1/manga`) fica atrás de um
Cloudflare que só libera JSON pra request com cara de XHR same-origin — nem
providers de scraping renderizados conseguem imitar isso de um datacenter
(ver `_catalogo_ativo` em adapters_novos.py e a seção "Catálogo/busca" de
docs/SCRAPING_API_COMIX.md). Um script rodando NO NAVEGADOR do usuário já tem
o cookie do Cloudflare e faz um XHR same-origin de verdade, então resolve os
dois problemas de graça — só que fora do servidor, então o resultado (um
JSON) precisa ser importado à parte. Este script é essa importação.

Uso:
    python import_comix_catalogo.py caminho/para/comix_catalogo_2026-08-01.json

O JSON esperado é uma lista de itens no MESMO formato que a API devolve
(cada item com "title", "altTitles" opcional, "url") — é exatamente o que o
userscript exporta.
"""

import argparse
import json
import sys

from adapters_novos import ComixAdapter, _pares_titulo_url
from common import carregar_config_match, finalizar_run, get_supabase, iniciar_run
from match_titulo import decidir_status, melhor_match
from tipo_titulo import familia_de_tipo, por_url
from update_obras import obras_sem_fonte_no_site


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("arquivo", help="JSON exportado pelo userscript (lista de itens do catálogo)")
    parser.add_argument("--dominio", default="comix.to", help="nome do site em sites_suportados (default: comix.to)")
    parser.add_argument("--url-base", default=None, help="url_base pro url_da_fonte (default: https://<dominio>)")
    args = parser.parse_args()

    with open(args.arquivo, encoding="utf-8") as f:
        itens = json.load(f)
    if not isinstance(itens, list):
        sys.exit(f"esperava uma lista de itens no JSON, achei {type(itens).__name__}")

    catalogo = _pares_titulo_url(itens)
    print(f"{len(catalogo)} título(s) casável(is) no export ({len(itens)} obra(s) no catálogo).")
    if not catalogo:
        return

    url_base = args.url_base or f"https://{args.dominio}"
    adapter = ComixAdapter()

    supabase = get_supabase()
    config = carregar_config_match(supabase)
    limiares = config.get("atualizar_obras", {"limiar_auto_aprovacao": 0.95, "limiar_minimo_pendencia": 0.70})

    todas_obras = supabase.table("obras").select("id, titulo, titulos_alternativos, tipo").execute().data
    todas_fontes = supabase.table("fontes").select("obra_id, site, url").execute().data
    obras = obras_sem_fonte_no_site(todas_obras, todas_fontes, args.dominio, url_base)
    print(f"{len(obras)} obra(s) ainda sem fonte no {args.dominio}.")

    run_id = iniciar_run(supabase, "obras", site_dominio=args.dominio)

    novas_fontes = []
    for obra in obras:
        familia_obra = familia_de_tipo(obra.get("tipo"))
        melhor_slug = None
        melhor_score = 0.0
        melhor_tipo = None
        for titulo_cat, slug in catalogo:
            candidato_url = adapter.url_da_fonte(url_base, slug)
            tipo_candidato = por_url(candidato_url)
            # Sinal de tipo (URL) diverge do tipo da obra: não é a mesma obra-tipo, pula.
            if familia_obra is not None and tipo_candidato is not None and tipo_candidato != familia_obra:
                continue
            score = melhor_match(titulo_cat, obra)
            if score > melhor_score:
                melhor_score = score
                melhor_slug = slug
                melhor_tipo = tipo_candidato

        if melhor_slug is None:
            continue
        status = decidir_status(melhor_score, limiares)
        if status is None:
            continue

        print(f"  {obra['titulo']}: {melhor_score:.2f} -> {status} ({melhor_slug})")
        novas_fontes.append(
            {
                "obra_id": obra["id"],
                "site": args.dominio,
                "url": adapter.url_da_fonte(url_base, melhor_slug),
                "ultimo_capitulo_detectado": None,
                "confiavel": True,
                "status_aprovacao": status,
                "descoberta_automaticamente": True,
                "ultima_verificacao": None,
                "tipo_detectado": melhor_tipo,
            }
        )

    if novas_fontes:
        supabase.table("fontes").insert(novas_fontes).execute()

    finalizar_run(
        supabase,
        run_id,
        "concluido",
        f"{len(novas_fontes)} nova(s) fonte(s) casada(s) (import manual do catálogo exportado)",
        resumo={"fontes_novas": len(novas_fontes)},
    )
    print(f"\nConcluído. {len(novas_fontes)} nova(s) fonte(s) casada(s).")


if __name__ == "__main__":
    main()
