import { updateObra } from '../db/repo';
import { IconeSparkle } from './Icones';
import type { Obra } from '../types';

/** Botão de favoritar (sparkle): cinza quando inativo, #FECC01 quando ativo.
 * Usado na lista (linha do título do card) e na página da obra (linha do
 * label Title). Toggle direto, sem passar pelo draft/autosave do formulário. */
export function FavoritoBotao({ obra, className }: { obra: Obra; className?: string }) {
  function alternar() {
    void updateObra(obra.id, { favorito: !obra.favorito });
  }

  return (
    <button
      type="button"
      className={`btn-icone favorito-botao ${obra.favorito ? 'favorito-ativo' : ''} ${className ?? ''}`}
      onClick={alternar}
      aria-pressed={obra.favorito}
      aria-label={obra.favorito ? 'Remove from Favorites' : 'Add to Favorites'}
      title={obra.favorito ? 'Remove from Favorites' : 'Add to Favorites'}
    >
      <IconeSparkle />
    </button>
  );
}
