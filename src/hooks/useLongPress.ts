import { useRef } from 'react';

interface Opts {
  onClick: () => void;
  onLongPress: () => void;
  delay?: number;
}

/**
 * Distingue clique curto de pressionar-e-segurar num único elemento (usado
 * pra abrir o modal de remoção sem precisar de um botão × separado). Cobre
 * mouse e touch; onContextMenu é bloqueado pra o long-press não disparar o
 * menu nativo (relevante quando o botão contém uma <img>, ex. safari mobile).
 */
export function useLongPress({ onClick, onLongPress, delay = 550 }: Opts) {
  const timer = useRef<number | null>(null);
  const disparou = useRef(false);

  function iniciar() {
    disparou.current = false;
    timer.current = window.setTimeout(() => {
      disparou.current = true;
      onLongPress();
    }, delay);
  }

  function cancelar() {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }

  function finalizar() {
    cancelar();
    if (!disparou.current) onClick();
  }

  return {
    onMouseDown: iniciar,
    onMouseUp: finalizar,
    onMouseLeave: cancelar,
    onTouchStart: iniciar,
    onTouchEnd: finalizar,
    onTouchCancel: cancelar,
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  };
}
