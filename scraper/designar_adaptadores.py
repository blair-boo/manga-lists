"""
Estágio "designar" do scraper: auto-detecção e auto-designação de adaptadores
para domínios de `sites_suportados` que ainda não têm adaptador designado
(ver HANDOUT_ARQUITETURA_SCRAPERS, seção "Fluxo de cadastro de fonte nova").

Para cada domínio com `adaptador IS NULL`:
  - roda REGISTRY.detect(url); se algum adaptador reconhece o site, grava o
    vínculo domínio->adaptador (adaptador + access_strategy do padrão que
    funcionou), limpa o diagnóstico e ativa o site (passa a ser varrido).
  - se nenhum adaptador reconhece, roda REGISTRY.diagnose(url) e grava o
    relatório em `diagnostico` (jsonb) para a fila de aprovação mostrar
    "domínio sem adaptador". O domínio segue com adaptador NULL e inativo.

Disparado manualmente pelo botão "Detect adapters" na aba Updates (via Edge
Function) e automaticamente quando uma fonte manual introduz um domínio novo.

Uso: python scraper/designar_adaptadores.py
"""

import traceback
from datetime import datetime, timezone

from adapters import REGISTRY, resolver_access_strategy
from common import finalizar_run, get_supabase, iniciar_run


def _relatorio_diagnostico(url: str) -> dict:
    """Relatório serializável (jsonb) do modo diagnóstico para um domínio sem adaptador."""
    entradas = [
        {
            "adapter_id": e.adapter_id,
            "matched": e.matched,
            "parse_status": e.parse_status,
            "mensagem": e.mensagem,
        }
        for e in REGISTRY.diagnose(url)
    ]
    return {"gerado_em": datetime.now(timezone.utc).isoformat(), "entradas": entradas}


def processar_site(supabase, site: dict) -> str:
    """Detecta e designa (ou diagnostica) um domínio. Retorna um rótulo do desfecho."""
    nome = site["nome"]
    url = site.get("url_base") or f"https://{nome}"

    adapter = REGISTRY.detect(url)
    if adapter is not None:
        estrategia = resolver_access_strategy(site.get("access_strategy"), adapter)
        supabase.table("sites_suportados").update(
            {
                "adaptador": adapter.id,
                "access_strategy": estrategia,
                "diagnostico": None,
                "ativo": True,
            }
        ).eq("id", site["id"]).execute()
        print(f"  {nome}: designado -> {adapter.id} ({estrategia})")
        return "designado"

    diagnostico = _relatorio_diagnostico(url)
    supabase.table("sites_suportados").update({"diagnostico": diagnostico}).eq("id", site["id"]).execute()
    print(f"  {nome}: nenhum adaptador reconheceu — diagnóstico gravado.")
    return "sem_adaptador"


def executar(supabase) -> tuple[int, int]:
    """Retorna (designados, sem_adaptador)."""
    sites = (
        supabase.table("sites_suportados")
        .select("id, nome, url_base, adaptador, access_strategy")
        .is_("adaptador", "null")
        .execute()
        .data
    )
    print(f"{len(sites)} domínio(s) sem adaptador para detectar.")

    designados = 0
    sem_adaptador = 0
    for site in sites:
        try:
            if processar_site(supabase, site) == "designado":
                designados += 1
            else:
                sem_adaptador += 1
        except Exception as exc:  # noqa: BLE001 - um domínio com erro não derruba o resto
            sem_adaptador += 1
            print(f"  {site.get('nome')}: erro na detecção — {exc}")

    print(f"\nConcluído. {designados} designado(s), {sem_adaptador} sem adaptador.")
    return designados, sem_adaptador


def main():
    supabase = get_supabase()
    run_id = iniciar_run(supabase, "designar")
    try:
        designados, sem_adaptador = executar(supabase)
        finalizar_run(
            supabase,
            run_id,
            "concluido",
            f"{designados} designado(s), {sem_adaptador} sem adaptador",
        )
    except Exception as exc:
        finalizar_run(supabase, run_id, "erro", f"{exc}\n{traceback.format_exc()}"[:2000])
        raise


if __name__ == "__main__":
    main()
