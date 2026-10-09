import { updateObra } from '../db/repo';
import { IconeNostalgic } from './Icones';
import type { Obra } from '../types';

/** Botão de nostalgia (ampulheta): cinza quando inativo, âmbar quando ativo.
 * Para mangás antigos que a usuária leu e amou, separado de Favoritos. Usado na
 * lista (linha do título do card) e na página da obra (linha do label Title).
 * Toggle direto, sem passar pelo draft/autosave do formulário. */
export function NostalgicBotao({ obra, className }: { obra: Obra; className?: string }) {
  function alternar() {
    void updateObra(obra.id, { nostalgic: !obra.nostalgic });
  }

  return (
    <button
      type="button"
      className={`btn-icone nostalgic-botao ${obra.nostalgic ? 'nostalgic-ativo' : ''} ${className ?? ''}`}
      onClick={alternar}
      aria-pressed={obra.nostalgic}
      aria-label={obra.nostalgic ? 'Remove from Nostalgic' : 'Add to Nostalgic'}
      title={obra.nostalgic ? 'Remove from Nostalgic' : 'Add to Nostalgic'}
    >
      <IconeNostalgic />
    </button>
  );
}
