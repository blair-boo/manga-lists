import { db, enqueueMutation } from './localDb';
import { newId } from '../lib/id';
import { deriveSite } from '../lib/site';
import { syncNow } from '../sync/sync';
import type { Fonte, Obra, StatusAprovacao } from '../types';

function triggerBackgroundSync(): void {
  void syncNow();
}

export type NovaObra = Omit<Obra, 'id' | 'criado_em' | 'atualizado_em'>;

export async function createObra(input: NovaObra, dispararSync = true): Promise<Obra> {
  const now = new Date().toISOString();
  const obra: Obra = { ...input, id: newId(), criado_em: now, atualizado_em: now };
  await db.obras.put(obra);
  await enqueueMutation({ entity: 'obras', op: 'insert', recordId: obra.id, payload: obra });
  if (dispararSync) triggerBackgroundSync();
  return obra;
}

/** Atualiza titulo/titulos_alternativos direto, sem disparar o espelhamento de novo (evita recursão). */
async function espelharTitulo(
  obraId: string,
  titulo: string | undefined,
  titulosAlternativos: string[] | null | undefined
): Promise<void> {
  const patch: Partial<NovaObra> = {};
  if (titulo !== undefined) patch.titulo = titulo;
  if (titulosAlternativos !== undefined) patch.titulos_alternativos = titulosAlternativos;
  if (Object.keys(patch).length === 0) return;

  const now = new Date().toISOString();
  await db.obras.update(obraId, { ...patch, atualizado_em: now });
  const full = await db.obras.get(obraId);
  if (!full) return;
  await enqueueMutation({ entity: 'obras', op: 'update', recordId: obraId, payload: full });
  triggerBackgroundSync();
}

export async function updateObra(id: string, changes: Partial<NovaObra>): Promise<void> {
  const now = new Date().toISOString();
  await db.obras.update(id, { ...changes, atualizado_em: now });
  const full = await db.obras.get(id);
  if (!full) return;
  await enqueueMutation({ entity: 'obras', op: 'update', recordId: id, payload: full });
  triggerBackgroundSync();

  // Espelha Title/Alternative Title pra obra vinculada (manga<->novel da mesma história, Bloco B3).
  if (full.obra_vinculada_id && ('titulo' in changes || 'titulos_alternativos' in changes)) {
    await espelharTitulo(full.obra_vinculada_id, changes.titulo, changes.titulos_alternativos);
  }
}

/** Vincula duas obras (manga<->novel da mesma história) — vínculo mútuo, Bloco B3. */
export async function vincularObras(obraIdA: string, obraIdB: string): Promise<void> {
  await updateObra(obraIdA, { obra_vinculada_id: obraIdB } as Partial<NovaObra>);
  await updateObra(obraIdB, { obra_vinculada_id: obraIdA } as Partial<NovaObra>);
}

export async function desvincularObra(obraId: string): Promise<void> {
  const obra = await db.obras.get(obraId);
  if (!obra) return;
  await updateObra(obraId, { obra_vinculada_id: null } as Partial<NovaObra>);
  if (obra.obra_vinculada_id) {
    await updateObra(obra.obra_vinculada_id, { obra_vinculada_id: null } as Partial<NovaObra>);
  }
}

/** Cria a obra correspondente (manga<->novel) já vinculada — cadastro inline (Bloco B3). */
export async function criarObraVinculada(obraOrigemId: string, dadosNovaObra: NovaObra): Promise<Obra> {
  const nova = await createObra(dadosNovaObra, false);
  await vincularObras(obraOrigemId, nova.id);
  triggerBackgroundSync();
  return nova;
}

export async function deleteObra(id: string): Promise<void> {
  await db.obras.delete(id);
  await db.fontes.where('obra_id').equals(id).delete();
  await enqueueMutation({ entity: 'obras', op: 'delete', recordId: id, payload: null });
  triggerBackgroundSync();
}

export type NovaFonte = Omit<Fonte, 'id' | 'criado_em'>;

export async function createFonte(input: NovaFonte, dispararSync = true): Promise<Fonte> {
  const fonte: Fonte = { ...input, id: newId(), criado_em: new Date().toISOString() };
  await db.fontes.put(fonte);
  await enqueueMutation({ entity: 'fontes', op: 'insert', recordId: fonte.id, payload: fonte });
  if (dispararSync) triggerBackgroundSync();
  return fonte;
}

export async function updateFonte(id: string, changes: Partial<NovaFonte>): Promise<void> {
  // Qualquer edição de capítulo feita por aqui (app) é manual por definição — o
  // scraper (Python) escreve direto no Supabase, sem passar por esta função.
  const merged: Partial<NovaFonte> = { ...changes };
  if ('ultimo_capitulo_detectado' in changes) merged.atualizado_por_scraper = false;

  await db.fontes.update(id, merged);
  const full = await db.fontes.get(id);
  if (!full) return;
  await enqueueMutation({ entity: 'fontes', op: 'update', recordId: id, payload: full });
  triggerBackgroundSync();
  await recalcUltimoCapituloLancado(full.obra_id);
}

export async function setFonteAprovacao(id: string, status: StatusAprovacao): Promise<void> {
  await updateFonte(id, { status_aprovacao: status });
}

/**
 * Define manualmente o tipo de uma fonte (manga/novel) e, opcionalmente, move a
 * fonte pra outra obra (a contraparte manga<->novel). Marca tipo_manual=true —
 * garantia crítica do Bloco B4: o scraper nunca sobrescreve essa decisão nem
 * reatribui a fonte de volta à obra original em runs futuras.
 */
export async function setFonteTipo(fonteId: string, tipo: Fonte['tipo_detectado'], novaObraId?: string): Promise<void> {
  const antes = await db.fontes.get(fonteId);
  const obraOrigemId = antes?.obra_id;

  const changes: Partial<NovaFonte> = { tipo_detectado: tipo, tipo_manual: true };
  if (novaObraId) changes.obra_id = novaObraId;

  await db.fontes.update(fonteId, changes);
  const full = await db.fontes.get(fonteId);
  if (!full) return;
  await enqueueMutation({ entity: 'fontes', op: 'update', recordId: fonteId, payload: full });
  triggerBackgroundSync();

  await recalcUltimoCapituloLancado(full.obra_id);
  if (obraOrigemId && obraOrigemId !== full.obra_id) {
    await recalcUltimoCapituloLancado(obraOrigemId);
  }
}

export async function deleteFonte(id: string): Promise<void> {
  const fonte = await db.fontes.get(id);
  await db.fontes.delete(id);
  await enqueueMutation({ entity: 'fontes', op: 'delete', recordId: id, payload: null });
  triggerBackgroundSync();
  if (fonte) await recalcUltimoCapituloLancado(fonte.obra_id);
}

async function recalcUltimoCapituloLancado(obraId: string): Promise<void> {
  const obra = await db.obras.get(obraId);
  if (!obra) return;

  const fontes = await db.fontes.where('obra_id').equals(obraId).toArray();
  const aprovadas = fontes.filter((f) => f.status_aprovacao === 'aprovado' && f.ultimo_capitulo_detectado != null);
  const maior = aprovadas.length > 0 ? Math.max(...aprovadas.map((f) => f.ultimo_capitulo_detectado as number)) : null;
  const viaScraper =
    maior !== null && aprovadas.some((f) => f.ultimo_capitulo_detectado === maior && f.atualizado_por_scraper);

  // Normaliza com ?? antes de comparar: registros locais antigos podem ter o
  // campo undefined, e undefined === null falharia gerando gravação redundante.
  if ((obra.ultimo_capitulo_lancado ?? null) === maior && (obra.ultimo_capitulo_via_scraper ?? false) === viaScraper)
    return;

  await updateObra(obraId, {
    ultimo_capitulo_lancado: maior,
    ultimo_capitulo_via_scraper: viaScraper,
  } as Partial<NovaObra>);
}

/**
 * Cria uma obra + suas fontes de uma vez. Dedupe de título case-insensitive:
 * se já existe uma obra com o mesmo título, retorna a existente sem criar nada.
 * Usada pela tela de Cadastrar (tanto no modo rápido quanto no completo).
 */
export async function criarObraComFontes(
  obra: NovaObra,
  urlsFontes: string[]
): Promise<{ obra: Obra; jaExistia: boolean }> {
  const existente = await db.obras.where('titulo').equalsIgnoreCase(obra.titulo.trim()).first();
  if (existente) {
    return { obra: existente, jaExistia: true };
  }

  // Adia o sync até obra + todas as fontes estarem enfileiradas, disparando uma
  // vez só no fim. Se disparasse durante o loop, o pullFontes (que faz clear +
  // refill do servidor) rodaria antes de as fontes serem enviadas e apagaria as
  // fontes locais recém-criadas — corrida que fazia as fontes "sumirem".
  const criada = await createObra(obra, false);

  for (const url of urlsFontes) {
    await createFonte(
      {
        obra_id: criada.id,
        site: deriveSite(url),
        url,
        ultimo_capitulo_detectado: null,
        atualizado_por_scraper: false,
        confiavel: true,
        status_aprovacao: 'aprovado',
        descoberta_automaticamente: false,
        ultima_verificacao: null,
        tipo_detectado: null,
        tipo_manual: false,
      },
      false
    );
  }

  triggerBackgroundSync();
  return { obra: criada, jaExistia: false };
}
