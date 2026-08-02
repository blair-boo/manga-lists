import { updateObra, type NovaObra } from '../db/repo';
import { renomearCapaSeNecessario } from './capaStorage';
import { mensagemDeErro } from './erros';
import type { Obra } from '../types';

/**
 * Ponto único de gravação de campos da obra fora do fluxo de criação.
 * Cuida do rename da capa quando titulo/tipo mudam e delega o resto pro
 * updateObra (que já faz enqueue, sync e espelhamento manga<->novel).
 * Usado pelo autosave da tela da obra e pelo Edit mode da lista.
 */
export async function salvarCamposObra(
  obra: Pick<Obra, 'id' | 'titulo' | 'tipo' | 'capa_url'>,
  changes: Partial<NovaObra>,
  aoFalharRename?: (mensagem: string) => void
): Promise<void> {
  // Cópia: quem chama costuma passar um literal, mas o patch não é nosso pra
  // mutar — a capa renomeada entra só na cópia.
  const patch: Partial<NovaObra> = { ...changes };

  if (('titulo' in patch || 'tipo' in patch) && obra.capa_url) {
    try {
      const novaCapaUrl = await renomearCapaSeNecessario(
        obra.capa_url,
        obra.titulo,
        obra.tipo,
        patch.titulo ?? obra.titulo,
        'tipo' in patch ? (patch.tipo ?? null) : obra.tipo
      );
      if (novaCapaUrl) patch.capa_url = novaCapaUrl;
    } catch (err) {
      aoFalharRename?.(mensagemDeErro(err));
      // segue a gravação dos outros campos mesmo se o rename da capa falhar
    }
  }
  await updateObra(obra.id, patch);
}
