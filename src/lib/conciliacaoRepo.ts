import { db } from '../db/localDb';
import { createFonte, updateObra } from '../db/repo';
import { supabase } from './supabaseClient';
import { mensagemDeErro } from './erros';
import { campoPorDominio, deriveSite } from './site';
import { familiaDeTipo } from './obra';
import { adicionarBlacklistConciliacao, listarBlacklistConciliacao } from './scraperConfig';
import { unirArrays } from './csvBulkUpdate';
import { chaveBlacklist, type CandidatoObra, type PlanoConciliacao } from './conciliacaoCsv';
import type { Obra, Tipo } from '../types';

/**
 * Camada de I/O do Modo 3 (Conciliação de sites relacionados) — lê/escreve no
 * Dexie/Supabase. A decisão de o que fazer com cada linha (o "plano") é toda
 * pura, em conciliacaoCsv.ts; aqui só executa.
 */

export async function carregarCandidatosConciliacao(tiposPermitidos: ReadonlySet<Tipo>): Promise<CandidatoObra[]> {
  const obras = await db.obras.toArray();
  return obras
    .filter((o) => o.tipo != null && tiposPermitidos.has(o.tipo))
    .map((o) => ({ obraId: o.id, titulo: o.titulo, titulosAlternativos: o.titulos_alternativos, tipo: o.tipo }));
}

export async function carregarBlacklistConciliacaoComoSet(): Promise<Set<string>> {
  const itens = await listarBlacklistConciliacao();
  return new Set(itens.map((i) => chaveBlacklist(i.obra_id, i.url)));
}

/**
 * Grava o link aprovado na obra: campo dedicado (novelupdates_url etc.)
 * quando o domínio é reconhecido, senão vira uma fonte genérica (mesmo padrão
 * de reconciliarFontes/adicionarFonteNaObra — não duplica se a URL já existe
 * entre as fontes da obra). `tituloParaAlternativo`, quando não-nulo, é unido
 * (união, nunca substitui) a `titulos_alternativos`.
 */
async function gravarLinkNaObra(obraId: string, url: string, tituloParaAlternativo: string | null): Promise<void> {
  const obra = await db.obras.get(obraId);
  if (!obra) return;

  const campo = campoPorDominio(url);
  if (campo) {
    const patch: Record<string, unknown> = { [campo]: url };
    if (tituloParaAlternativo) {
      patch.titulos_alternativos = unirArrays(obra.titulos_alternativos, [tituloParaAlternativo]);
    }
    await updateObra(obraId, patch as Partial<Obra>);
    return;
  }

  const fontesAtuais = await db.fontes.where('obra_id').equals(obraId).toArray();
  if (!fontesAtuais.some((f) => f.url === url)) {
    const maiorOrdem = fontesAtuais.reduce((max, f) => (f.ordem != null && f.ordem > max ? f.ordem : max), -1);
    await createFonte({
      obra_id: obraId,
      site: deriveSite(url),
      url,
      ultimo_capitulo_detectado: null,
      atualizado_por_scraper: false,
      confiavel: true,
      status_aprovacao: 'aprovado',
      descoberta_automaticamente: false,
      ultima_verificacao: null,
      tipo_detectado: familiaDeTipo(obra.tipo),
      tipo_manual: false,
      ordem: maiorOrdem + 1,
    });
  }
  if (tituloParaAlternativo) {
    await updateObra(obraId, { titulos_alternativos: unirArrays(obra.titulos_alternativos, [tituloParaAlternativo]) });
  }
}

export interface ResultadoAplicacaoConciliacao {
  autoAplicados: number;
  pendentesGravados: number;
  erros: string[];
}

/** Executa o plano montado por `montarPlanoConciliacao`: grava os auto-aprovados e registra os pendentes na fila. */
export async function aplicarPlanoConciliacao(plano: PlanoConciliacao): Promise<ResultadoAplicacaoConciliacao> {
  let autoAplicados = 0;
  const erros: string[] = [];

  for (const item of plano.autoAprovados) {
    try {
      await gravarLinkNaObra(item.obraId, item.url, item.exato ? null : item.titulo);
      autoAplicados++;
    } catch (err) {
      erros.push(mensagemDeErro(err));
    }
  }

  let pendentesGravados = 0;
  for (const item of plano.pendentesNovos) {
    try {
      const { error } = await supabase.from('conciliacao_pendentes').upsert(
        {
          obra_id: item.obraId,
          titulo_candidato: item.titulo,
          url_candidato: item.url,
          score: item.score,
          status_aprovacao: 'pendente',
        },
        { onConflict: 'obra_id,url_candidato' }
      );
      if (error) throw error;
      pendentesGravados++;
    } catch (err) {
      erros.push(mensagemDeErro(err));
    }
  }

  return { autoAplicados, pendentesGravados, erros };
}

// --- Fila de aprovação (70-89% e empates) -----------------------------------

export interface PendenteConciliacaoComObra {
  id: string;
  obra_id: string;
  titulo_candidato: string;
  url_candidato: string;
  score: number;
  criado_em: string;
  obra: { id: string; titulo: string; titulos_alternativos: string[] | null } | null;
}

export async function listarPendentesConciliacao(): Promise<PendenteConciliacaoComObra[]> {
  const { data, error } = await supabase
    .from('conciliacao_pendentes')
    .select('id, obra_id, titulo_candidato, url_candidato, score, criado_em, obra:obras(id, titulo, titulos_alternativos)')
    .eq('status_aprovacao', 'pendente')
    .order('score', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as PendenteConciliacaoComObra[];
}

/**
 * Aprova um item da fila: grava o link (campo dedicado ou fonte genérica) e
 * SEMPRE une o título candidato a `titulos_alternativos` (diferente do
 * auto-aprovado exato — na fila o match nunca é garantido idêntico). Quando o
 * mesmo link estava pendente pra outra obra (empate de score — melhorMatch
 * retornou mais de uma candidata), essa aprovação decide a ambiguidade: os
 * outros pendentes com a mesma URL somem da fila (reprovados), sem entrar na
 * blacklist — não é que o par esteja errado, é que outra obra já ficou com o link.
 */
export async function aprovarPendenteConciliacao(p: PendenteConciliacaoComObra): Promise<void> {
  await gravarLinkNaObra(p.obra_id, p.url_candidato, p.titulo_candidato);
  const { error } = await supabase
    .from('conciliacao_pendentes')
    .update({ status_aprovacao: 'aprovado' })
    .eq('id', p.id);
  if (error) throw error;
  await supabase
    .from('conciliacao_pendentes')
    .update({ status_aprovacao: 'reprovado' })
    .eq('url_candidato', p.url_candidato)
    .eq('status_aprovacao', 'pendente')
    .neq('id', p.id);
}

/** Rejeita um item da fila: registra o par (obra, url) na blacklist — não sugere de novo numa importação futura. */
export async function rejeitarPendenteConciliacao(p: PendenteConciliacaoComObra): Promise<void> {
  await adicionarBlacklistConciliacao(p.obra_id, p.url_candidato);
  const { error } = await supabase
    .from('conciliacao_pendentes')
    .update({ status_aprovacao: 'reprovado' })
    .eq('id', p.id);
  if (error) throw error;
}
