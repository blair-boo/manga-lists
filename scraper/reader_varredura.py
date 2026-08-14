"""
Varredura da aba Reader: descobre capítulos novos e datas de liberação de
paywall das obras inscritas.

A linha que guia o desenho da aba: DETECTAR é automático, BAIXAR é sempre
decisão da usuária. Este script fica inteiro do lado do "detectar" — ele lê a
LISTA de capítulos (rótulo, data, se está bloqueado) e nada mais. Nenhum texto
de capítulo é lido, baixado ou gravado aqui; isso é outra fase, disparada
manualmente com a fonte escolhida por ela.

O que grava em reader_capitulos:
  - capítulo novo e livre     -> estado 'descoberto'  (esperando a decisão dela)
  - capítulo novo e no paywall-> estado 'bloqueado'   (+ disponivel_em)
  - capítulo que já existe    -> atualiza url/estado/disponivel_em

É idempotente por (reader_obra_id, chave) — a constraint da migration 0022.
Rodar duas vezes atualiza as linhas em vez de duplicar. Um capítulo que sai do
paywall é reconhecido como o MESMO capítulo (ganha url, deixa de ser
'bloqueado'), que é exatamente o que a chave por rótulo resolve e a chave por
URL não resolveria.

Uso:
    python scraper/reader_varredura.py                # todas as obras inscritas
    python scraper/reader_varredura.py --obra <uuid>  # só uma (env READER_OBRA_ID)
"""

import argparse
import os
import sys
import time
import traceback
from datetime import datetime, timezone

from adapter_base import resolver_access_strategy
from adapters import REGISTRY
from common import get_supabase, host_de_url, iniciar_run, finalizar_run

# Estados que significam "o texto já está no nosso storage". A varredura NUNCA
# rebaixa um capítulo desses de volta pra 'descoberto'/'bloqueado' — senão uma
# passagem do scraper apagaria o trabalho já feito de download/formatação.
ESTADOS_INTOCAVEIS = {"baixado", "formatado", "publicado"}

# Pausa entre obras do MESMO host. A varredura faz uma requisição por obra, mas
# a biblioteca é concentrada: ~25 das obras vêm do mesmo site. Sem pausa isso
# vira uma rajada contra um site pequeno de tradução, que é tanto falta de
# educação quanto um bom jeito de ser bloqueado. 1s é folgado pra uma tarefa que
# roda a cada quinze dias. Hosts diferentes não esperam um pelo outro.
PAUSA_ENTRE_OBRAS_S = 1.0


def agora_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def carregar_designacoes(supabase) -> dict:
    """host -> {'adaptador', 'access_strategy'} a partir de sites_suportados."""
    linhas = supabase.table("sites_suportados").select("nome,url_base,adaptador,access_strategy").execute().data or []
    designacoes = {}
    for linha in linhas:
        host = host_de_url(linha.get("url_base") or "") or (linha.get("nome") or "").lower()
        if host:
            designacoes[host] = {
                "adaptador": linha.get("adaptador"),
                "access_strategy": linha.get("access_strategy"),
            }
    return designacoes


def escolher_fonte(fontes: list[dict]) -> dict | None:
    """
    A fonte de onde a varredura lê. `preferida` é a escolha da usuária; sem
    ela, a primeira ativa por ordem. Nunca inventa uma fonte — obra sem fonte
    cadastrada simplesmente não é varrida (e o painel mostra o erro).
    """
    ativas = [f for f in fontes if f.get("ativa") and f.get("url_indice")]
    if not ativas:
        return None
    ativas.sort(key=lambda f: (not f.get("preferida"), f.get("ordem") if f.get("ordem") is not None else 1e9))
    return ativas[0]


def listar_capitulos_da_fonte(fonte: dict, designacoes: dict):
    """Devolve (capitulos, diagnostico). capitulos=None quando não deu."""
    url = fonte["url_indice"]
    host = host_de_url(url)
    designacao = designacoes.get(host, {})

    adapter_id = fonte.get("adaptador") or designacao.get("adaptador")
    adapter = REGISTRY.por_id(adapter_id) if adapter_id else REGISTRY.detect(url)
    if adapter is None:
        return None, f"nenhum adaptador para {host}"

    estrategia = resolver_access_strategy(designacao.get("access_strategy"), adapter)
    raw = adapter.fetch(url, estrategia)
    if raw.status == "acesso_bloqueado":
        return None, f"acesso bloqueado ({adapter.id}): {raw.diagnostico or ''}".strip()
    if raw.status != "ok":
        return None, f"falha ao buscar ({adapter.id}): {raw.diagnostico or ''}".strip()

    capitulos = adapter.listar_capitulos(raw)
    if capitulos is None:
        # Não é erro de acesso: o adaptador existe mas ainda não sabe listar
        # (só implementamos Madara até agora). Reportar claramente em vez de
        # fingir que a obra não tem capítulos.
        return None, f"adaptador '{adapter.id}' ainda não lista capítulos"
    return capitulos, None


def sincronizar_capitulos(supabase, reader_obra: dict, fonte: dict, capitulos: list) -> dict:
    """Insere os capítulos novos e atualiza os que já existem. Retorna contadores."""
    existentes = (
        supabase.table("reader_capitulos")
        .select("id,chave,estado,url,disponivel_em")
        .eq("reader_obra_id", reader_obra["id"])
        .execute()
        .data
        or []
    )
    por_chave = {c["chave"]: c for c in existentes}

    novos, atualizados, liberados = [], 0, 0
    for cap in capitulos:
        estado = "bloqueado" if cap.bloqueado else "descoberto"
        atual = por_chave.get(cap.chave)

        if atual is None:
            novos.append(
                {
                    "reader_obra_id": reader_obra["id"],
                    "obra_id": reader_obra["obra_id"],
                    "reader_fonte_id": fonte["id"],
                    "chave": cap.chave,
                    "id_externo": cap.id_externo,
                    "numero": cap.numero,
                    "numero_texto": cap.numero_texto,
                    "titulo": cap.titulo,
                    "side_story": cap.side_story,
                    "ordem": cap.ordem,
                    "estado": estado,
                    "estado_em": agora_iso(),
                    "disponivel_em": cap.disponivel_em,
                    "url": cap.url,
                }
            )
            continue

        # Já existe. Nunca rebaixa quem já foi baixado/formatado/publicado.
        patch = {}
        if cap.url and atual.get("url") != cap.url:
            patch["url"] = cap.url
        if cap.disponivel_em != atual.get("disponivel_em"):
            patch["disponivel_em"] = cap.disponivel_em
        if atual.get("estado") not in ESTADOS_INTOCAVEIS and atual.get("estado") != estado:
            patch["estado"] = estado
            patch["estado_em"] = agora_iso()
            if atual.get("estado") == "bloqueado" and estado == "descoberto":
                liberados += 1
        if patch:
            supabase.table("reader_capitulos").update(patch).eq("id", atual["id"]).execute()
            atualizados += 1

    if novos:
        supabase.table("reader_capitulos").insert(novos).execute()

    return {"novos": len(novos), "atualizados": atualizados, "liberados": liberados}


def carregar_fontes_por_obra(supabase) -> dict[str, list[dict]]:
    """
    Todas as reader_fontes numa consulta só, agrupadas por obra. Uma consulta
    por obra funcionaria, mas além de ser N vezes mais lento, o host da fonte
    precisa ser conhecido ANTES da requisição pra decidir a pausa de educação.
    """
    linhas = supabase.table("reader_fontes").select("*").execute().data or []
    por_obra: dict[str, list[dict]] = {}
    for linha in linhas:
        por_obra.setdefault(linha["reader_obra_id"], []).append(linha)
    return por_obra


def varrer_obra(supabase, reader_obra: dict, fontes: list[dict], designacoes: dict) -> dict:
    fonte = escolher_fonte(fontes)
    if fonte is None:
        raise RuntimeError("obra sem fonte ativa com url_indice")

    capitulos, diagnostico = listar_capitulos_da_fonte(fonte, designacoes)
    if capitulos is None:
        raise RuntimeError(diagnostico or "não foi possível listar capítulos")

    contadores = sincronizar_capitulos(supabase, reader_obra, fonte, capitulos)

    regulares = [c for c in capitulos if not c.side_story]
    supabase.table("reader_obras").update(
        {
            "total_capitulos_site": len(regulares),
            "total_side_stories_site": len(capitulos) - len(regulares),
            "ultima_busca_em": agora_iso(),
            "ultima_busca_ok": True,
            "ultima_busca_mensagem": None,
            # A varredura foi pedida e cumprida: desarma o toggle manual.
            "busca_manual": False,
        }
    ).eq("id", reader_obra["id"]).execute()

    contadores["total"] = len(capitulos)
    return contadores


def executar(supabase, obra_id: str | None = None) -> None:
    query = supabase.table("reader_obras").select("*").eq("concluido", False)
    if obra_id:
        query = query.eq("obra_id", obra_id)
    reader_obras = query.execute().data or []

    if not reader_obras:
        alvo = f" para a obra {obra_id}" if obra_id else ""
        print(f"Nenhuma obra do Reader em andamento{alvo}.")
        return

    designacoes = carregar_designacoes(supabase)
    fontes_por_obra = carregar_fontes_por_obra(supabase)
    run_id = iniciar_run(supabase, "reader")
    falhas = 0
    totais = {"novos": 0, "atualizados": 0, "liberados": 0}

    try:
        ultimo_host: str | None = None
        for reader_obra in reader_obras:
            rotulo = reader_obra.get("obra_id")
            fontes = fontes_por_obra.get(reader_obra["id"], [])
            try:
                # Pausa só quando a obra anterior veio do MESMO site — hosts
                # diferentes não têm por que esperar um pelo outro.
                escolhida = escolher_fonte(fontes)
                host = host_de_url(escolhida["url_indice"]) if escolhida else None
                if host is not None and host == ultimo_host:
                    time.sleep(PAUSA_ENTRE_OBRAS_S)
                ultimo_host = host

                c = varrer_obra(supabase, reader_obra, fontes, designacoes)
                for k in totais:
                    totais[k] += c[k]
                print(
                    f"  {rotulo}: {c['total']} capítulos "
                    f"({c['novos']} novos, {c['atualizados']} atualizados, {c['liberados']} liberados)"
                )
            except Exception as exc:  # noqa: BLE001 - uma obra com erro não derruba as seguintes
                falhas += 1
                # O erro fica visível no painel, na coluna da última busca.
                supabase.table("reader_obras").update(
                    {
                        "ultima_busca_em": agora_iso(),
                        "ultima_busca_ok": False,
                        "ultima_busca_mensagem": str(exc)[:500],
                    }
                ).eq("id", reader_obra["id"]).execute()
                print(f"  {rotulo}: erro — {exc}", file=sys.stderr)

        status = "concluido" if falhas == 0 else "erro"
        mensagem = None if falhas == 0 else f"{falhas} obra(s) falharam na varredura"
        finalizar_run(supabase, run_id, status, mensagem, resumo={**totais, "obras": len(reader_obras), "falhas": falhas})
    except Exception as exc:  # noqa: BLE001 - falha global ainda precisa fechar a run
        finalizar_run(supabase, run_id, "erro", f"{exc}\n{traceback.format_exc()}"[:2000])
        raise

    print(
        f"\nConcluído. {len(reader_obras)} obra(s), {totais['novos']} capítulo(s) novo(s), "
        f"{totais['liberados']} liberado(s) do paywall, {falhas} falha(s)."
    )


def main():
    parser = argparse.ArgumentParser(description="Varredura de capítulos da aba Reader (não baixa nada).")
    parser.add_argument("--obra", help="UUID de uma obra específica (padrão: todas as inscritas em andamento)")
    args = parser.parse_args()

    obra_id = args.obra or os.environ.get("READER_OBRA_ID") or None
    executar(get_supabase(), obra_id)


if __name__ == "__main__":
    main()
