import { db, enqueueMutation } from './localDb';
import { newId } from '../lib/id';
import { deriveSite } from '../lib/site';
import { escolherDuplicata, type ObraDuplicada } from '../lib/duplicatas';
import { syncNow } from '../sync/sync';
import type {
  Fonte,
  Obra,
  ReaderCapitulo,
  ReaderFonte,
  ReaderObra,
  StatusAprovacao,
} from '../types';

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

/**
 * Campos espelhados entre obras vinculadas (manga<->novel da mesma história).
 * novelupdates_url entra aqui (Handout 3, E6): o link do NU refere-se à história,
 * que é a mesma para as duas contrapartes. pdf NÃO entra — é independente por obra.
 */
const CAMPOS_ESPELHADOS = [
  'titulo',
  'titulos_alternativos',
  'generos',
  'tags',
  'novelupdates_url',
  // Links de catálogo referem-se à história, que é a mesma nas duas
  // contrapartes manga<->novel. Mesma justificativa do novelupdates_url.
  'anilist_url',
  'myanimelist_url',
  'mangaupdates_url',
  'mangadex_url',
  'mangabaka_url',
] as const;

/** Replica os campos espelhados na obra vinculada, sem reentrar no espelhamento (evita recursão). */
async function espelharCampos(obraId: string, changes: Partial<NovaObra>): Promise<void> {
  const patch: Partial<NovaObra> = {};
  for (const campo of CAMPOS_ESPELHADOS) {
    if (campo in changes) (patch as Record<string, unknown>)[campo] = changes[campo];
  }
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

  // Espelha os quatro campos (título, títulos alternativos, gêneros, tags) pra
  // obra vinculada (manga<->novel da mesma história). espelharCampos grava direto
  // no Dexie + enqueue, sem passar por updateObra, então não re-dispara o espelho.
  if (full.obra_vinculada_id && CAMPOS_ESPELHADOS.some((campo) => campo in changes)) {
    await espelharCampos(full.obra_vinculada_id, changes);
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
  // As linhas do Reader caem por cascade no Postgres; aqui a limpeza local é
  // explícita, no mesmo espírito da limpeza de fontes acima. Não enfileira
  // delete de cada uma: o cascade do servidor já cuida do lado remoto.
  const readerObras = (await db.reader_obras.where('obra_id').equals(id).primaryKeys()) as string[];
  await db.reader_obras.where('obra_id').equals(id).delete();
  await db.reader_capitulos.where('obra_id').equals(id).delete();
  if (readerObras.length > 0) {
    await db.reader_fontes.where('reader_obra_id').anyOf(readerObras).delete();
  }
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
 * Procura uma obra já cadastrada com o mesmo título. A regra em si vive em
 * ../lib/duplicatas (módulo puro, testável); aqui só entra a leitura do Dexie.
 * `excluirId` tira a própria obra da busca — sem ele, editar o título de uma
 * obra existente acusaria duplicata contra ela mesma.
 */
export async function encontrarObraDuplicada(titulo: string, excluirId?: string): Promise<ObraDuplicada | null> {
  return escolherDuplicata(await db.obras.toArray(), titulo, excluirId);
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
        ordem: null,
      },
      false
    );
  }

  triggerBackgroundSync();
  return { obra: criada, jaExistia: false };
}

// ---------------------------------------------------------------------------
// Reader
//
// Mesmo padrão de createFonte/updateFonte: grava no Dexie, enfileira a mutação
// e dispara o sync em background. Nada aqui acessa a rede diretamente.
// ---------------------------------------------------------------------------

export type NovaReaderObra = Omit<ReaderObra, 'id' | 'criado_em' | 'atualizado_em'>;
export type NovaReaderFonte = Omit<ReaderFonte, 'id' | 'criado_em' | 'atualizado_em'>;
export type NovoReaderCapitulo = Omit<ReaderCapitulo, 'id' | 'criado_em' | 'atualizado_em'>;

/** Valores iniciais de uma obra recém-inscrita no Reader. */
export function readerObraPadrao(obraId: string): NovaReaderObra {
  return {
    obra_id: obraId,
    concluido: false,
    busca_manual: false,
    estado: 'aguardando',
    estado_em: new Date().toISOString(),
    ultima_busca_em: null,
    ultima_busca_ok: null,
    ultima_busca_mensagem: null,
    total_capitulos_site: null,
    total_side_stories_site: null,
    info_titulo: null,
    info_autor: null,
    info_score: null,
    info_status: null,
    info_link: null,
    info_sinopse: null,
    info_generos: null,
    info_tags: null,
    espelhar: {},
    pasta_storage: null,
    capa_path: null,
    epub_path: null,
    epub_gerado_em: null,
    epub_parcial_path: null,
    epub_parcial_gerado_em: null,
    pdf_path: null,
    pdf_gerado_em: null,
  };
}

export async function criarReaderObra(input: NovaReaderObra, dispararSync = true): Promise<ReaderObra> {
  const now = new Date().toISOString();
  const readerObra: ReaderObra = { ...input, id: newId(), criado_em: now, atualizado_em: now };
  await db.reader_obras.put(readerObra);
  await enqueueMutation({ entity: 'reader_obras', op: 'insert', recordId: readerObra.id, payload: readerObra });
  if (dispararSync) triggerBackgroundSync();
  return readerObra;
}

export async function updateReaderObra(id: string, changes: Partial<NovaReaderObra>): Promise<void> {
  await db.reader_obras.update(id, { ...changes, atualizado_em: new Date().toISOString() });
  const full = await db.reader_obras.get(id);
  if (!full) return;
  await enqueueMutation({ entity: 'reader_obras', op: 'update', recordId: id, payload: full });
  triggerBackgroundSync();
}

/** Remove a obra do Reader. As fontes e capítulos caem por cascade no servidor. */
export async function deleteReaderObra(id: string): Promise<void> {
  await db.reader_obras.delete(id);
  await db.reader_fontes.where('reader_obra_id').equals(id).delete();
  await db.reader_capitulos.where('reader_obra_id').equals(id).delete();
  await enqueueMutation({ entity: 'reader_obras', op: 'delete', recordId: id, payload: null });
  triggerBackgroundSync();
}

export async function criarReaderFonte(input: NovaReaderFonte, dispararSync = true): Promise<ReaderFonte> {
  const now = new Date().toISOString();
  const fonte: ReaderFonte = { ...input, id: newId(), criado_em: now, atualizado_em: now };
  await db.reader_fontes.put(fonte);
  await enqueueMutation({ entity: 'reader_fontes', op: 'insert', recordId: fonte.id, payload: fonte });
  if (dispararSync) triggerBackgroundSync();
  return fonte;
}

export async function updateReaderFonte(id: string, changes: Partial<NovaReaderFonte>): Promise<void> {
  await db.reader_fontes.update(id, { ...changes, atualizado_em: new Date().toISOString() });
  const full = await db.reader_fontes.get(id);
  if (!full) return;
  await enqueueMutation({ entity: 'reader_fontes', op: 'update', recordId: id, payload: full });
  triggerBackgroundSync();
}

export async function deleteReaderFonte(id: string): Promise<void> {
  await db.reader_fontes.delete(id);
  await enqueueMutation({ entity: 'reader_fontes', op: 'delete', recordId: id, payload: null });
  triggerBackgroundSync();
}

/**
 * Marca uma fonte como preferida, desmarcando as outras da mesma obra —
 * "preferida" é o default da tela de download, então só uma faz sentido.
 */
export async function definirFontePreferida(readerObraId: string, fonteId: string): Promise<void> {
  const fontes = await db.reader_fontes.where('reader_obra_id').equals(readerObraId).toArray();
  for (const fonte of fontes) {
    const deveSer = fonte.id === fonteId;
    if (fonte.preferida !== deveSer) await updateReaderFonte(fonte.id, { preferida: deveSer });
  }
}

export async function criarReaderCapitulo(
  input: NovoReaderCapitulo,
  dispararSync = true
): Promise<ReaderCapitulo> {
  const now = new Date().toISOString();
  const capitulo: ReaderCapitulo = { ...input, id: newId(), criado_em: now, atualizado_em: now };
  await db.reader_capitulos.put(capitulo);
  await enqueueMutation({ entity: 'reader_capitulos', op: 'insert', recordId: capitulo.id, payload: capitulo });
  if (dispararSync) triggerBackgroundSync();
  return capitulo;
}

export async function updateReaderCapitulo(id: string, changes: Partial<NovoReaderCapitulo>): Promise<void> {
  // Toda troca de estado carimba estado_em: é o que a lista mostra como
  // "data/hora do status" sem precisar de um campo separado por estágio.
  const merged: Partial<NovoReaderCapitulo> = { ...changes };
  if ('estado' in changes) merged.estado_em = new Date().toISOString();

  await db.reader_capitulos.update(id, { ...merged, atualizado_em: new Date().toISOString() });
  const full = await db.reader_capitulos.get(id);
  if (!full) return;
  await enqueueMutation({ entity: 'reader_capitulos', op: 'update', recordId: id, payload: full });
  triggerBackgroundSync();
}

export async function deleteReaderCapitulo(id: string): Promise<void> {
  await db.reader_capitulos.delete(id);
  await enqueueMutation({ entity: 'reader_capitulos', op: 'delete', recordId: id, payload: null });
  triggerBackgroundSync();
}
