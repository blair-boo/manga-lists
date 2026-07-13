import { db, enqueueMutation } from './localDb';
import { newId } from '../lib/id';
import { deriveSite } from '../lib/site';
import { syncNow } from '../sync/sync';
import type { Fonte, Obra, StatusAprovacao, StatusLeitura } from '../types';

function triggerBackgroundSync(): void {
  void syncNow();
}

export type NovaObra = Omit<Obra, 'id' | 'criado_em' | 'atualizado_em'>;

export async function createObra(input: NovaObra): Promise<Obra> {
  const now = new Date().toISOString();
  const obra: Obra = { ...input, id: newId(), criado_em: now, atualizado_em: now };
  await db.obras.put(obra);
  await enqueueMutation({ entity: 'obras', op: 'insert', recordId: obra.id, payload: obra });
  triggerBackgroundSync();
  return obra;
}

export async function updateObra(id: string, changes: Partial<NovaObra>): Promise<void> {
  const now = new Date().toISOString();
  await db.obras.update(id, { ...changes, atualizado_em: now });
  const full = await db.obras.get(id);
  if (!full) return;
  await enqueueMutation({ entity: 'obras', op: 'update', recordId: id, payload: full });
  triggerBackgroundSync();
}

export async function deleteObra(id: string): Promise<void> {
  await db.obras.delete(id);
  await db.fontes.where('obra_id').equals(id).delete();
  await enqueueMutation({ entity: 'obras', op: 'delete', recordId: id, payload: null });
  triggerBackgroundSync();
}

export type NovaFonte = Omit<Fonte, 'id' | 'criado_em'>;

export async function createFonte(input: NovaFonte): Promise<Fonte> {
  const fonte: Fonte = { ...input, id: newId(), criado_em: new Date().toISOString() };
  await db.fontes.put(fonte);
  await enqueueMutation({ entity: 'fontes', op: 'insert', recordId: fonte.id, payload: fonte });
  triggerBackgroundSync();
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

export async function deleteFonte(id: string): Promise<void> {
  const fonte = await db.fontes.get(id);
  await db.fontes.delete(id);
  await enqueueMutation({ entity: 'fontes', op: 'delete', recordId: id, payload: null });
  triggerBackgroundSync();
  if (fonte) await recalcUltimoCapituloLancado(fonte.obra_id);
}

async function recalcUltimoCapituloLancado(obraId: string): Promise<void> {
  const fontes = await db.fontes.where('obra_id').equals(obraId).toArray();
  const aprovadas = fontes.filter((f) => f.status_aprovacao === 'aprovado' && f.ultimo_capitulo_detectado != null);
  const maior = aprovadas.length > 0 ? Math.max(...aprovadas.map((f) => f.ultimo_capitulo_detectado as number)) : null;
  const viaScraper =
    maior !== null && aprovadas.some((f) => f.ultimo_capitulo_detectado === maior && f.atualizado_por_scraper);
  await updateObra(obraId, {
    ultimo_capitulo_lancado: maior,
    ultimo_capitulo_via_scraper: viaScraper,
  } as Partial<NovaObra>);
}

export interface CadastroRapidoInput {
  titulo: string;
  titulosAlternativos: string[];
  autor: string | null;
  capaUrl: string | null;
  statusLeitura: StatusLeitura;
  capituloAtual: number;
  urlsFontes: string[];
}

/** Cadastro rápido: cria uma obra + suas fontes de uma vez. Dedupe de título case-insensitive. */
export async function criarObraRapida(
  input: CadastroRapidoInput
): Promise<{ obra: Obra; jaExistia: boolean }> {
  const tituloLower = input.titulo.trim().toLowerCase();
  const existentes = await db.obras.toArray();
  const existente = existentes.find((o) => o.titulo.trim().toLowerCase() === tituloLower);
  if (existente) {
    return { obra: existente, jaExistia: true };
  }

  const obra = await createObra({
    tipo: null,
    titulo: input.titulo.trim(),
    titulos_alternativos: input.titulosAlternativos.length > 0 ? input.titulosAlternativos : null,
    autor: input.autor,
    capa_url: input.capaUrl,
    capitulo_atual: input.capituloAtual,
    status_leitura: input.statusLeitura,
    status_publicacao: null,
    ultimo_capitulo_lancado: null,
    ultimo_capitulo_via_scraper: false,
    nota: null,
    generos: null,
    tags: null,
    observacoes: null,
  });

  for (const url of input.urlsFontes) {
    await createFonte({
      obra_id: obra.id,
      site: deriveSite(url),
      url,
      ultimo_capitulo_detectado: null,
      atualizado_por_scraper: false,
      confiavel: true,
      status_aprovacao: 'aprovado',
      descoberta_automaticamente: false,
      ultima_verificacao: null,
    });
  }

  return { obra, jaExistia: false };
}
