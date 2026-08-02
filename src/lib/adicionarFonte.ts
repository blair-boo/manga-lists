import { createFonte } from '../db/repo';
import { familiaDeTipo } from './obra';
import { registrarDominioManual } from './scraperConfig';
import { deriveSite } from './site';
import type { Fonte, Tipo } from '../types';

/**
 * Cria uma fonte manual numa obra, no mesmo formato usado pela tela da obra:
 * site derivado da URL, ordem no fim da lista, tipo herdado da obra e registro
 * do domínio como site suportado. Ponto único usado pela tela da obra e pelo
 * Edit mode da lista.
 */
export async function adicionarFonteNaObra(
  obraId: string,
  url: string,
  tipoObra: Tipo | null,
  fontesAtuais: Fonte[]
): Promise<void> {
  // Nova fonte entra no fim da lista: maior ordem atual + 1 (Bloco F).
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
    // Fonte cadastrada à mão direto na obra já nasce com o tipo da obra
    // (Manga/Manwha/Manhua contam todos como 'manga' — familiaDeTipo).
    tipo_detectado: familiaDeTipo(tipoObra),
    tipo_manual: false,
    ordem: maiorOrdem + 1,
  });
  void registrarDominioManual(url); // domínio novo inserido à mão vira site suportado
}
