import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type ToastTipo = 'ok' | 'erro' | 'info';

interface ToastItem {
  id: number;
  mensagem: string;
  tipo: ToastTipo;
}

interface ToastContextValue {
  mostrarToast: (mensagem: string, tipo?: ToastTipo) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const proximoId = useRef(1);

  const mostrarToast = useCallback((mensagem: string, tipo: ToastTipo = 'ok') => {
    const id = proximoId.current++;
    setToasts((atual) => [...atual, { id, mensagem, tipo }]);
    setTimeout(() => {
      setToasts((atual) => atual.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  return (
    <ToastContext.Provider value={{ mostrarToast }}>
      {children}
      <div className="toast-container" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tipo}`} role="status">
            {t.mensagem}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast precisa estar dentro de ToastProvider');
  return ctx;
}
