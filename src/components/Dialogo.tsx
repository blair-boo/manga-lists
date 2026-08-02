import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ModalBase } from './ModalBase';

/**
 * Diálogos próprios do app (E2): substituem confirm()/prompt() nativos, que no
 * iOS PWA standalone fogem do tema e são limitados. Dois níveis de uso:
 *  - componentes controlados ConfirmDialog/PromptDialog (casos especiais);
 *  - hook useDialogos() com confirmar()/pedirTexto() em Promise, renderizado
 *    uma vez pelo DialogosProvider (no Layout) — o caminho normal.
 */

interface ConfirmDialogProps {
  aberto: boolean;
  titulo?: string;
  mensagem: string;
  confirmarRotulo?: string;
  /** Quando true, o botão de confirmação usa o estilo de perigo (danger). */
  perigoso?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

interface PromptDialogProps {
  aberto: boolean;
  titulo?: string;
  mensagem: string;
  valorInicial?: string;
  confirmarRotulo?: string;
  onConfirmar: (valor: string) => void;
  onCancelar: () => void;
}

export function ConfirmDialog({
  aberto,
  titulo,
  mensagem,
  confirmarRotulo = 'Confirm',
  perigoso,
  onConfirmar,
  onCancelar,
}: ConfirmDialogProps) {
  return (
    <ModalBase aberto={aberto} rotulo={titulo ?? mensagem} onFechar={onCancelar}>
      {titulo && <h3 className="modal-titulo">{titulo}</h3>}
      <p>{mensagem}</p>
      <div className="modal-acoes">
        <button type="button" className={perigoso ? 'botao-perigoso' : ''} onClick={onConfirmar} data-autofocus>
          {confirmarRotulo}
        </button>
        <button type="button" onClick={onCancelar}>
          Cancel
        </button>
      </div>
    </ModalBase>
  );
}

export function PromptDialog({
  aberto,
  titulo,
  mensagem,
  valorInicial = '',
  confirmarRotulo = 'OK',
  onConfirmar,
  onCancelar,
}: PromptDialogProps) {
  const [valor, setValor] = useState(valorInicial);

  useEffect(() => {
    if (aberto) setValor(valorInicial);
  }, [aberto, valorInicial]);

  return (
    <ModalBase aberto={aberto} rotulo={titulo ?? mensagem} onFechar={onCancelar}>
      {titulo && <h3 className="modal-titulo">{titulo}</h3>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onConfirmar(valor);
        }}
      >
        <label>
          {mensagem}
          <input type="text" value={valor} onChange={(e) => setValor(e.target.value)} data-autofocus />
        </label>
        <div className="modal-acoes">
          <button type="submit">{confirmarRotulo}</button>
          <button type="button" onClick={onCancelar}>
            Cancel
          </button>
        </div>
      </form>
    </ModalBase>
  );
}

// --- Provider/hook em Promise (o caminho normal de uso) ---------------------

export interface ConfirmarOpts {
  titulo?: string;
  mensagem: string;
  confirmarRotulo?: string;
  perigoso?: boolean;
}

export interface PedirTextoOpts {
  titulo?: string;
  mensagem: string;
  valorInicial?: string;
  confirmarRotulo?: string;
}

interface DialogosApi {
  /** Equivalente a confirm(): resolve true no confirmar, false no cancelar/Esc. */
  confirmar(opts: ConfirmarOpts): Promise<boolean>;
  /** Equivalente a prompt(): resolve o texto no confirmar, null no cancelar/Esc. */
  pedirTexto(opts: PedirTextoOpts): Promise<string | null>;
}

type Pendente =
  | { tipo: 'confirm'; opts: ConfirmarOpts; resolver: (v: boolean) => void }
  | { tipo: 'prompt'; opts: PedirTextoOpts; resolver: (v: string | null) => void };

const DialogosContext = createContext<DialogosApi | null>(null);

export function DialogosProvider({ children }: { children: ReactNode }) {
  const [pendente, setPendente] = useState<Pendente | null>(null);
  const pendenteRef = useRef<Pendente | null>(null);

  const abrir = useCallback((novo: Pendente) => {
    // Defensivo: um pedido novo cancela o anterior (nenhum fluxo legítimo abre
    // dois diálogos ao mesmo tempo; sem isso a Promise antiga ficaria pendurada).
    const atual = pendenteRef.current;
    if (atual) {
      if (atual.tipo === 'confirm') atual.resolver(false);
      else atual.resolver(null);
    }
    pendenteRef.current = novo;
    setPendente(novo);
  }, []);

  const fechar = useCallback(() => {
    pendenteRef.current = null;
    setPendente(null);
  }, []);

  const api = useMemo<DialogosApi>(
    () => ({
      confirmar: (opts) => new Promise<boolean>((resolve) => abrir({ tipo: 'confirm', opts, resolver: resolve })),
      pedirTexto: (opts) => new Promise<string | null>((resolve) => abrir({ tipo: 'prompt', opts, resolver: resolve })),
    }),
    [abrir]
  );

  return (
    <DialogosContext.Provider value={api}>
      {children}
      {pendente?.tipo === 'confirm' && (
        <ConfirmDialog
          aberto
          {...pendente.opts}
          onConfirmar={() => {
            pendente.resolver(true);
            fechar();
          }}
          onCancelar={() => {
            pendente.resolver(false);
            fechar();
          }}
        />
      )}
      {pendente?.tipo === 'prompt' && (
        <PromptDialog
          aberto
          {...pendente.opts}
          onConfirmar={(valor) => {
            pendente.resolver(valor);
            fechar();
          }}
          onCancelar={() => {
            pendente.resolver(null);
            fechar();
          }}
        />
      )}
    </DialogosContext.Provider>
  );
}

export function useDialogos(): DialogosApi {
  const ctx = useContext(DialogosContext);
  if (!ctx) throw new Error('useDialogos precisa estar dentro de <DialogosProvider>');
  return ctx;
}
