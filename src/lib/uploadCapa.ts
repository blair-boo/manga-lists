import { supabase } from './supabaseClient';
import { slugDaObra } from './capaStorage';
import type { Tipo } from '../types';

const BUCKET = 'capas';

export async function uploadCapa(file: File, titulo: string, tipo: Tipo | null): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${slugDaObra(titulo, tipo)}.${ext}`;
  // upsert: true é proposital — nome agora é determinístico pelo slug, então
  // reenviar a capa da mesma obra deve sobrescrever, não conflitar.
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
