import { supabase } from './supabaseClient';

export interface ImagemBaixada {
  blob: Blob;
  contentType: string;
}

async function mensagemDoErroFuncao(err: unknown): Promise<string> {
  const contexto = (err as { context?: unknown } | null)?.context;
  if (contexto instanceof Response) {
    try {
      const corpo = await contexto.clone().json();
      if (corpo && typeof corpo.error === 'string') return corpo.error;
    } catch {
      // segue pro fallback
    }
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Busca uma imagem via Edge Function `image-proxy` (bypassa CORS de sites de
 * terceiros — ver supabase/functions/image-proxy/README.md). `signal`
 * permite cancelar/repetir o download de um item isolado do lote
 * (src/lib/imagensBatch.ts) sem afetar os demais.
 */
export async function baixarImagemViaProxy(url: string, signal?: AbortSignal): Promise<ImagemBaixada> {
  const { data, error, response } = await supabase.functions.invoke('image-proxy', {
    body: { url },
    signal,
  });
  if (error) {
    throw new Error(await mensagemDoErroFuncao(error));
  }
  if (!(data instanceof Blob)) {
    throw new Error('Unexpected response from image-proxy (not a Blob)');
  }
  // A function sempre devolve Content-Type: application/octet-stream (ver
  // README) pra o cliente supabase-js fazer parse como Blob em vez de texto;
  // o tipo real vem no header X-Image-Content-Type.
  const contentType = response?.headers.get('X-Image-Content-Type') || data.type || 'application/octet-stream';
  const blob = contentType === data.type ? data : new Blob([data], { type: contentType });
  return { blob, contentType };
}
