"""
Lógica compartilhada de match de título entre o candidato encontrado (título do
catálogo de um site, ou resultado de busca) e as obras já cadastradas.

Usada por update_obras.py (candidato = título do catálogo do site) e por
discover_fontes.py (candidato = resultado da busca). Os limiares vêm de
`configuracoes_scraper` (tabela no Supabase), escolhendo a chave 'atualizar_obras'
ou 'buscar_novas_fontes' conforme o script.
"""

from rapidfuzz import fuzz


def melhor_match(titulo_candidato: str, obra: dict) -> float:
    """
    Compara o título candidato contra o título principal e todos os títulos
    alternativos da obra; retorna o maior score (0.0 a 1.0).

    Usa token_sort_ratio (ignora ordem das palavras), o que ajuda em casos como
    "Forgotten Field, The" vs "The Forgotten Field" ou títulos com subtítulo.
    """
    titulos = [obra["titulo"]] + (obra.get("titulos_alternativos") or [])
    scores = [fuzz.token_sort_ratio(titulo_candidato, t) for t in titulos if t]
    if not scores:
        return 0.0
    return max(scores) / 100


def decidir_status(score: float, limiares: dict) -> str | None:
    """
    Decide o status_aprovacao de uma fonte a partir do score de título.

    Retorna 'aprovado' (auto-aprovação), 'pendente' (vai pra fila de revisão),
    ou None (descartar sem registrar). Mantém a nomenclatura de status atual do
    projeto ('aprovado' | 'pendente' | 'rejeitado').
    """
    if score >= limiares["limiar_auto_aprovacao"]:
        return "aprovado"
    if score >= limiares["limiar_minimo_pendencia"]:
        return "pendente"
    return None
