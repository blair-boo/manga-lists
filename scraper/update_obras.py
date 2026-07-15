"""
Estágio "obras" do scraper: varre o catálogo completo de cada site suportado e
casa os títulos com obras já cadastradas que ainda não têm fonte naquele site.

Cobre qualquer site do mesmo CMS Next.js mapeado em SITES_NEXTJS_CMS
(hoje nyxscans e ezmanga) — catálogo via {api}/api/posts.

Cada fonte encontrada entra em `fontes` com o status decidido pelo score de
título (auto-aprovada, pendente, ou descartada) usando os limiares de
`configuracoes_scraper` (chave 'match_titulo' -> 'atualizar_obras').

Uso: python scraper/update_obras.py
Requer SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente (ou scraper/.env local).
"""

import traceback

from common import (
    SITES_NEXTJS_CMS,
    carregar_config_match,
    finalizar_run,
    get_supabase,
    host_de_url,
    iniciar_run,
    listar_todos_posts_cms,
)
from match_titulo import decidir_status, melhor_match


def obras_sem_fonte_no_site(supabase, nome_site: str, cfg: dict) -> list[dict]:
    """Obras que ainda não têm nenhuma fonte nesse site (por nome de site ou host da url)."""
    obras = supabase.table("obras").select("id, titulo, titulos_alternativos").execute().data
    fontes = supabase.table("fontes").select("obra_id, site, url").execute().data

    host_site = host_de_url(cfg["site"])
    obra_ids_com_fonte = set()
    for f in fontes:
        if f.get("site") == nome_site or host_de_url(f.get("url") or "") == host_site:
            obra_ids_com_fonte.add(f["obra_id"])

    return [o for o in obras if o["id"] not in obra_ids_com_fonte]


def processar_site(supabase, nome_site: str, cfg: dict, limiares: dict) -> int:
    """Varre o catálogo de um site e insere fontes casadas. Retorna quantas inseriu."""
    catalogo = listar_todos_posts_cms(cfg)
    print(f"  {nome_site}: {len(catalogo)} títulos no catálogo.")
    if not catalogo:
        return 0

    obras = obras_sem_fonte_no_site(supabase, nome_site, cfg)
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
                "url": f"{cfg['site']}/series/{melhor_slug}",
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
        cfg = SITES_NEXTJS_CMS.get(nome)
        if cfg is None:
            print(f"{nome}: catálogo não mapeado (não é um CMS conhecido), pulando.")
            continue

        run_id = iniciar_run(supabase, "obras", site_dominio=nome)
        try:
            quantidade = processar_site(supabase, nome, cfg, limiares)
            total += quantidade
            finalizar_run(supabase, run_id, "concluido", f"{quantidade} nova(s) fonte(s) casada(s)")
        except Exception as exc:  # noqa: BLE001 - um site com erro não derruba os outros
            finalizar_run(supabase, run_id, "erro", f"{exc}\n{traceback.format_exc()}"[:2000])
            print(f"{nome}: erro — {exc}")

    print(f"\nConcluído. {total} nova(s) fonte(s) casada(s) no total.")


if __name__ == "__main__":
    main()
