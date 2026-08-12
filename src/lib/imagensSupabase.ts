import { supabase } from './supabaseClient';

export const BUCKET_IMAGENS_IMPORTADAS = 'imagens-importadas';

/** Placeholder gravado ao criar uma pasta vazia — Storage não tem "criar pasta" própria, só existe via um objeto dentro dela. */
const ARQUIVO_MARCADOR_PASTA = '.keep';

/** Pastas existentes na raiz do bucket. Mesma convenção de listarIcones em src/pages/TestesPage.tsx: pseudo-entradas de pasta vêm com `id: null`. */
export async function listarPastasSupabase(): Promise<string[]> {
  const { data, error } = await supabase.storage
    .from(BUCKET_IMAGENS_IMPORTADAS)
    .list('', { sortBy: { column: 'name', order: 'asc' } });
  if (error) throw error;
  return (data ?? []).filter((item) => item.id === null).map((item) => item.name);
}

export async function criarPastaSupabase(nome: string): Promise<void> {
  const placeholder = new Blob([''], { type: 'text/plain' });
  const { error } = await supabase.storage
    .from(BUCKET_IMAGENS_IMPORTADAS)
    .upload(`${nome}/${ARQUIVO_MARCADOR_PASTA}`, placeholder, { upsert: true });
  if (error) throw error;
}

/** Nomes de arquivo já existentes numa pasta (raiz = ''), pra resolução de colisão de nome antes do upload. */
export async function listarArquivosPastaSupabase(pasta: string): Promise<string[]> {
  const { data, error } = await supabase.storage
    .from(BUCKET_IMAGENS_IMPORTADAS)
    .list(pasta, { sortBy: { column: 'name', order: 'asc' } });
  if (error) throw error;
  return (data ?? []).filter((item) => item.id !== null && item.name !== ARQUIVO_MARCADOR_PASTA).map((item) => item.name);
}

/** Sobe uma imagem já baixada (blob do image-proxy) pra pasta escolhida e devolve a URL pública. `upsert: false` — colisão de nome já foi resolvida antes desta chamada (ver resolverColisaoNome). */
export async function enviarImagemSupabase(
  blob: Blob,
  pasta: string,
  nomeArquivo: string,
  contentType: string
): Promise<string> {
  const path = pasta ? `${pasta}/${nomeArquivo}` : nomeArquivo;
  const { error } = await supabase.storage
    .from(BUCKET_IMAGENS_IMPORTADAS)
    .upload(path, blob, { contentType, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET_IMAGENS_IMPORTADAS).getPublicUrl(path);
  return data.publicUrl;
}
