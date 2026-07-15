"""
Estágio "obras" do scraper: varre o catálogo completo de cada site suportado e
casa os títulos com obras já cadastradas que ainda não têm fonte naquele site.

Diferente do discover_fontes (que procura fora, por obra), este vai na direção
oposta: parte do catálogo do site. Útil quando o site adicionou um título que
você já acompanha, mas ainda não tem fonte nele.

Nesta fase só o nyxscans está mapeado (catálogo via api.nyxscans.com/api/posts).
O catálogo do ezmanga ainda não foi investigado.

Cada fonte encontrada entra em `fontes` com o status decidido pelo score de
título (auto-aprovada, pendente, ou descartada) usando os limiares de
`configuracoes_scraper` (chave 'match_titulo' → 'atualizar_obras').

Uso: python scraper/update_obras.py
Requer SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente (ou scraper/.env local).
"""

import traceback

from common import (
    carregar_config_match,
    eh_nyxscans,
    finalizar_run,
    get_supabase,
    iniciar_run,
    listar_todos_posts_nyxscans,
)
from match_titulo import decidir_status, melhor_match

# Sites com catálogo mapeado -> função que devolve [(titulo, slug), ...] e monta a URL.
CATALOGOS = {
    "nyxscans": {
        "listar": listar_todos_posts_nyxscans,
        "url_da_fonte": lambda slug: f"https://nyxscans.com/series/{slug}",
        "pertence": eh_nyxscans,
    },
}


def obras_sem_fonte_no_site(supabase, pertence) -> list[dict]:
    """Obras que ainda não têm nenhuma fonte cujo domínio pertença ao site."""
    obras = supabase.table("obras").select("id, titulo, titulos_alternativos").execute().data
    fontes = supabase.table("fontes").select("obra_id, site, url").execute().data

    obra_ids_com_fonte = set()
    for f in fontes:
        url = f.get("url") or ""
        if (f.get("site") == "nyxscans") or pertence(url):
            obra_ids_com_fonte.add(f["obra_id"])

    return [o for o in obras if o["id"] not in obra_ids_com_fonte]


def processar_site(supabase, nome_site: str, config_site: dict, limiares: dict) -> int:
    """Varre o catálogo de um site e insere fontes casadas. Retorna quantas inseriu."""
    catalogo = config_site["listar"]()
    print(f"  {nome_site}: {len(catalogo)} títulos no catálogo.")
    if not catalogo:
        return 0

    obras = obras_sem_fonte_no_site(supabase, config_site["pertence"])
    print(f"  {len(obras)} obra(s) ainda sem fonte no {nome_site}.")

    novas_fontes = []
    for obra in obras:
        melhor_slug = None
        melhor_score = 0.0
        for titulo_cat, slug in catalogo:
            score = melhor_match(titulo_cat, obra)
            if score > melhor_score:
                melhor_score = score
                melhor_slug = slug

        if melhor_slug is None:
            continue
        status = decidir_status(melhor_score, limiares)
        if status is None:
            continue

        print(f"    {obra['titulo']}: {melhor_score:.2f} -> {status} ({melhor_slug})")
        novas_fontes.append(
            {
                "obra_id": obra["id"],
                "site": nome_site,
                "url": config_site["url_da_fonte"](melhor_slug),
                "ultimo_capitulo_detectado": None,
                "confiavel": True,
                "status_aprovacao": status,
                "descoberta_automaticamente": True,
                "ultima_verificacao": None,
            }
        )

    if novas_fontes:
        supabase.table("fontes").insert(novas_fontes).execute()
    return len(novas_fontes)


def main():
    supabase = get_supabase()
    config = carregar_config_match(supabase)
    limiares = config.get("atualizar_obras", {"limiar_auto_aprovacao": 0.95, "limiar_minimo_pendencia": 0.70})

    sites = supabase.table("sites_suportados").select("nome, ativo").eq("ativo", True).execute().data

    total = 0
    for site in sites:
        nome = site["nome"]
        config_site = CATALOGOS.get(nome)
        if config_site is None:
            print(f"{nome}: catálogo não mapeado, pulando.")
            continue

        run_id = iniciar_run(supabase, "obras", site_dominio=nome)
        try:
            quantidade = processar_site(supabase, nome, config_site, limiares)
            total += quantidade
            finalizar_run(supabase, run_id, "concluido", f"{quantidade} nova(s) fonte(s) casada(s)")
        except Exception as exc:  # noqa: BLE001 - um site com erro não derruba os outros
            finalizar_run(supabase, run_id, "erro", f"{exc}\n{traceback.format_exc()}"[:2000])
            print(f"{nome}: erro — {exc}")

    print(f"\nConcluído. {total} nova(s) fonte(s) casada(s) no total.")


if __name__ == "__main__":
    main()
