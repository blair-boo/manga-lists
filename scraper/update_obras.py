"""
Estágio "obras" do scraper: varre o catálogo completo de cada site suportado e
casa os títulos com obras já cadastradas que ainda não têm fonte naquele site.

Roteia por adaptador designado ao domínio (sites_suportados.adaptador) e resolve
a estratégia de acesso (domínio > padrão do adaptador). Só varre quando a
estratégia é 'http' (única implementada); domínios em flaresolverr/playwright
ficam registrados como "acesso pendente" até o fetcher existir.

Cada fonte encontrada entra em `fontes` com o status decidido pelo score de
título (auto-aprovada, pendente, ou descartada) — limiares de
`configuracoes_scraper` (chave 'match_titulo' -> 'atualizar_obras').

Uso: python scraper/update_obras.py
"""

import traceback

from adapters import ACCESS_HTTP, REGISTRY, resolver_access_strategy
from common import (
    carregar_config_match,
    finalizar_run,
    get_supabase,
    host_de_url,
    iniciar_run,
)
from match_titulo import decidir_status, melhor_match
from tipo_titulo import familia_de_tipo, por_url


def obras_sem_fonte_no_site(supabase, nome_site: str, url_base: str) -> list[dict]:
    """Obras que ainda não têm nenhuma fonte nesse site (por nome de site ou host da url)."""
    obras = supabase.table("obras").select("id, titulo, titulos_alternativos, tipo").execute().data
    fontes = supabase.table("fontes").select("obra_id, site, url").execute().data

    host_site = host_de_url(url_base)
    obra_ids_com_fonte = set()
    for f in fontes:
        if f.get("site") == nome_site or host_de_url(f.get("url") or "") == host_site:
            obra_ids_com_fonte.add(f["obra_id"])

    return [o for o in obras if o["id"] not in obra_ids_com_fonte]


def processar_site(supabase, nome_site: str, adapter, url_base: str, limiares: dict) -> int:
    """Varre o catálogo de um site (via adaptador) e insere fontes casadas."""
    catalogo = adapter.listar_catalogo(url_base)
    print(f"  {nome_site}: {len(catalogo)} títulos no catálogo.")
    if not catalogo:
        return 0

    obras = obras_sem_fonte_no_site(supabase, nome_site, url_base)
    print(f"  {len(obras)} obra(s) ainda sem fonte no {nome_site}.")

    novas_fontes = []
    for obra in obras:
        familia_obra = familia_de_tipo(obra.get("tipo"))
        melhor_slug = None
        melhor_score = 0.0
        melhor_tipo = None
        for titulo_cat, slug in catalogo:
            candidato_url = adapter.url_da_fonte(url_base, slug)
            tipo_candidato = por_url(candidato_url)
            # Sinal de tipo (URL) diverge do tipo da obra (ex.: obra é Manga, candidato
            # é a versão Novel da mesma história): não é a mesma obra-tipo, pula (B1/B0).
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

        print(f"    {obra['titulo']}: {melhor_score:.2f} -> {status} ({melhor_slug})")
        novas_fontes.append(
            {
                "obra_id": obra["id"],
                "site": nome_site,
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
    return len(novas_fontes)


def main():
    supabase = get_supabase()
    config = carregar_config_match(supabase)
    limiares = config.get("atualizar_obras", {"limiar_auto_aprovacao": 0.95, "limiar_minimo_pendencia": 0.70})

    sites = (
        supabase.table("sites_suportados")
        .select("nome, url_base, ativo, adaptador, access_strategy")
        .eq("ativo", True)
        .execute()
        .data
    )

    total = 0
    for site in sites:
        nome = site["nome"]
        adaptador_id = site.get("adaptador")
        adapter = REGISTRY.por_id(adaptador_id) if adaptador_id else None

        # Sempre registra uma run pra esse site, mesmo quando não há nada a
        # fazer (sem adaptador, adaptador sem catálogo, ou acesso pendente) —
        # senão o site fica pra sempre com "no run yet" na aba Updates, mesmo
        # que o scraper já tenha olhado pra ele e decidido, corretamente, não
        # varrer (ex.: adaptadores de site único não implementam catálogo).
        run_id = iniciar_run(supabase, "obras", site_dominio=nome)

        if adapter is None:
            finalizar_run(supabase, run_id, "concluido", "domínio sem adaptador designado — nada a varrer")
            print(f"{nome}: sem adaptador designado, pulando.")
            continue

        if not hasattr(adapter, "listar_catalogo"):
            finalizar_run(
                supabase,
                run_id,
                "concluido",
                f"adaptador '{adapter.id}' não expõe catálogo (site de fonte única) — nada a varrer aqui",
            )
            print(f"{nome}: adaptador '{adapter.id}' sem catálogo, pulando.")
            continue

        url_base = site.get("url_base") or f"https://{nome}"
        estrategia = resolver_access_strategy(site.get("access_strategy"), adapter)

        if estrategia != ACCESS_HTTP:
            finalizar_run(supabase, run_id, "concluido", f"acesso '{estrategia}' ainda não disponível — catálogo não varrido")
            print(f"{nome}: acesso '{estrategia}' não implementado, catálogo não varrido.")
            continue

        try:
            quantidade = processar_site(supabase, nome, adapter, url_base, limiares)
            total += quantidade
            finalizar_run(supabase, run_id, "concluido", f"{quantidade} nova(s) fonte(s) casada(s)")
        except Exception as exc:  # noqa: BLE001 - um site com erro não derruba os outros
            finalizar_run(supabase, run_id, "erro", f"{exc}\n{traceback.format_exc()}"[:2000])
            print(f"{nome}: erro — {exc}")

    print(f"\nConcluído. {total} nova(s) fonte(s) casada(s) no total.")


if __name__ == "__main__":
    main()
