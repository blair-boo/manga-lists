import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

interface ModalBaseProps {
  aberto: boolean;
  /** Rótulo acessível do diálogo. */
  rotulo: string;
  /** Chamado pelo X, pelo Esc e pelo clique no backdrop. */
  onFechar: () => void;
  /** Classe extra no .modal (ex.: 'cadastro-rapido-resultado'). */
  classe?: string;
  children: ReactNode;
}

/** Foco inicial + trap de Tab dentro do diálogo enquanto aberto. */
export function useFocoPreso(aberto: boolean, ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!aberto) return;
    const el = ref.current;
    if (!el) return;

    const focaveis = () =>
      Array.from(el.querySelectorAll<HTMLElement>('button, input, textarea, select, [tabindex]')).filter(
        (f) => !f.hasAttribute('disabled')
      );

    (el.querySelector<HTMLElement>('[data-autofocus]') ?? focaveis()[0])?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const lista = focaveis();
      if (lista.length === 0) return;
      const primeiro = lista[0];
      const ultimo = lista[lista.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    }

    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [aberto, ref]);
}

/**
 * Estrutura comum de todos os modais do app: backdrop + caixa + X fora da
 * caixa no canto superior direito. X, Esc e clique no backdrop fecham; clique
 * dentro da caixa não fecha. Foco fica preso dentro da caixa (Tab/Shift+Tab).
 */
export function ModalBase({ aberto, rotulo, onFechar, classe, children }: ModalBaseProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFocoPreso(aberto, ref);

  if (!aberto) return null;

  return (
    <div
      className="modal-backdrop"
      onKeyDown={(e) => e.key === 'Escape' && onFechar()}
      onClick={(e) => {
        if (e.target === e.currentTarget) onFechar();
      }}
    >
      {/* O foco fica preso no .modal-wrap, não no .modal: o X é irmão da caixa
          (fica fora dela, no canto), e prendê-lo só no .modal o deixaria
          inalcançável por Tab. */}
      <div className="modal-wrap" ref={ref}>
        <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Close">
          ×
        </button>
        <div className={classe ? `modal ${classe}` : 'modal'} role="dialog" aria-modal="true" aria-label={rotulo}>
          {children}
        </div>
      </div>
    </div>
  );
}
