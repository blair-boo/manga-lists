import { db, enqueueMutation } from './localDb';
import { newId } from '../lib/id';
import { syncNow } from '../sync/sync';
import type { Fonte, Obra, StatusAprovacao } from '../types';

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

export async function setFonteAprovacao(id: string, status: StatusAprovacao): Promise<void> {
  await db.fontes.update(id, { status_aprovacao: status });
  const full = await db.fontes.get(id);
  if (!full) return;
  await enqueueMutation({ entity: 'fontes', op: 'update', recordId: id, payload: full });
  triggerBackgroundSync();

  if (status === 'aprovado') {
    await recalcUltimoCapituloLancado(full.obra_id);
  }
}

export async function deleteFonte(id: string): Promise<void> {
  await db.fontes.delete(id);
  await enqueueMutation({ entity: 'fontes', op: 'delete', recordId: id, payload: null });
  triggerBackgroundSync();
}

async function recalcUltimoCapituloLancado(obraId: string): Promise<void> {
  const fontes = await db.fontes.where('obra_id').equals(obraId).toArray();
  const aprovadas = fontes.filter((f) => f.status_aprovacao === 'aprovado' && f.ultimo_capitulo_detectado != null);
  if (aprovadas.length === 0) return;
  const maior = Math.max(...aprovadas.map((f) => f.ultimo_capitulo_detectado as number));
  await updateObra(obraId, { ultimo_capitulo_lancado: maior } as Partial<NovaObra>);
}

/** Cadastro rápido: uma obra por linha, dedupe case-insensitive contra o que já existe localmente. */
export async function cadastroRapido(
  linhas: string[],
  tipoPadrao: Obra['tipo'] = null
): Promise<{ criadas: string[]; jaExistiam: string[] }> {
  const existentes = await db.obras.toArray();
  const titulosExistentes = new Set(existentes.map((o) => o.titulo.trim().toLowerCase()));

  const criadas: string[] = [];
  const jaExistiam: string[] = [];

  for (const linhaBruta of linhas) {
    const titulo = linhaBruta.trim();
    if (!titulo) continue;
    if (titulosExistentes.has(titulo.toLowerCase())) {
      jaExistiam.push(titulo);
      continue;
    }
    await createObra({
      tipo: tipoPadrao,
      titulo,
      autor: null,
      capa_url: null,
      capitulo_atual: null,
      status_leitura: null,
      status_publicacao: null,
      ultimo_capitulo_lancado: null,
      nota: null,
      generos: null,
      tags: null,
      observacoes: null,
    });
    titulosExistentes.add(titulo.toLowerCase());
    criadas.push(titulo);
  }

  return { criadas, jaExistiam };
}
