import { supabase } from './supabaseClient';
import type { Tipo } from '../types';

const BUCKET = 'capas';

/** Mesma lógica do slugify em scripts/migrate_capas.py: remove acentos, minúsculas,
 * troca tudo que não é a-z0-9 por '-', sem '-' nas pontas. */
export function slugify(titulo: string): string {
  const semAcento = titulo.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return semAcento
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Sufixo -novel só para tipo Novel; manga/manhwa/manhua ficam com o slug puro. */
export function slugDaObra(titulo: string, tipo: Tipo | null): string {
  const base = slugify(titulo);
  return tipo === 'Novel' ? `${base}-novel` : base;
}

/** Extrai o path dentro do bucket 'capas' a partir da URL pública, ou null se a
 * URL não pertencer a esse bucket (capa colada manualmente, por exemplo). */
function pathNoBucket(capaUrl: string): string | null {
  const marcador = `/storage/v1/object/public/${BUCKET}/`;
  const i = capaUrl.indexOf(marcador);
  if (i === -1) return null;
  // Remove querystring (ex.: cache buster "?v=..." adicionado pelo upload) antes
  // de comparar com o slug esperado.
  const semQuery = capaUrl.slice(i + marcador.length).split('?')[0];
  return semQuery;
}

/**
 * Renomeia o arquivo de capa no Storage quando título/tipo mudam, evitando
 * órfãos. Só age quando o path atual bate exatamente com o slug calculado a
 * partir dos valores ANTIGOS (ou seja, a capa é "gerenciada pelo slug"); capas
 * externas ou já dessincronizadas não são tocadas (retorna null). Retorna a
 * nova capa_url pública quando o rename acontece, ou null quando não havia
 * nada a fazer. Lança erro se o rename falhar (ex.: colisão com slug já
 * existente de outra obra) — quem chama decide como avisar.
 */
export async function renomearCapaSeNecessario(
  capaUrlAtual: string | null,
  tituloAntigo: string,
  tipoAntigo: Tipo | null,
  tituloNovo: string,
  tipoNovo: Tipo | null
): Promise<string | null> {
  if (!capaUrlAtual) return null;

  const pathAtual = pathNoBucket(capaUrlAtual);
  if (!pathAtual) return null; // capa externa, não mexe

  const ext = pathAtual.split('.').pop() ?? 'jpg';
  const slugAntigoEsperado = `${slugDaObra(tituloAntigo, tipoAntigo)}.${ext}`;
  if (pathAtual !== slugAntigoEsperado) return null; // já dessincronizada, não mexe

  const slugNovo = `${slugDaObra(tituloNovo, tipoNovo)}.${ext}`;
  if (slugNovo === pathAtual) return null; // slug não mudou, nada a fazer

  const { error } = await supabase.storage.from(BUCKET).move(pathAtual, slugNovo);
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(slugNovo);
  return data.publicUrl;
}

/**
 * Apaga o arquivo de capa no Storage a partir da publicUrl. No-op silencioso
 * pra capa externa (não pertence ao bucket 'capas') — não há o que apagar.
 */
export async function deletarCapa(capaUrl: string): Promise<void> {
  const path = pathNoBucket(capaUrl);
  if (!path) return;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}

/**
 * Apaga a capa ANTIGA no Storage depois de trocar por uma nova, mas só quando
 * o path realmente mudou. O upload usa upsert:true num path determinístico
 * pelo slug (ver uploadCapa) — se a extensão do arquivo novo bate com a
 * antiga, o path é o MESMO e o upload já sobrescreveu sozinho; apagar de novo
 * seria redundante. Path diferente (extensão trocou, ex. .jpg -> .webp) é
 * exatamente o caso que deixa órfão: a capa antiga continua existindo no
 * Storage sem nada mais apontando pra ela.
 */
export async function deletarCapaAntigaSeDiferente(capaAntiga: string | null, capaNova: string): Promise<void> {
  if (!capaAntiga) return;
  const pathAntigo = pathNoBucket(capaAntiga);
  const pathNovo = pathNoBucket(capaNova);
  if (!pathAntigo || !pathNovo || pathAntigo === pathNovo) return;
  const { error } = await supabase.storage.from(BUCKET).remove([pathAntigo]);
  if (error) throw error;
}
