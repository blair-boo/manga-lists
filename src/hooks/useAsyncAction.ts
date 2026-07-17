import { useCallback, useState } from 'react';
import { mensagemDeErro } from '../lib/erros';

/** Encapsula o padrão executando/erro de ações assíncronas disparadas pela UI. */
export function useAsyncAction<Args extends unknown[]>(fn: (...args: Args) => Promise<void>) {
  const [executando, setExecutando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const executar = useCallback(
    async (...args: Args) => {
      setExecutando(true);
      setErro(null);
      try {
        await fn(...args);
      } catch (err) {
        setErro(mensagemDeErro(err));
      } finally {
        setExecutando(false);
      }
    },
    [fn]
  );

  return { executar, executando, erro, limparErro: () => setErro(null) };
}
