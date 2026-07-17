import { useCallback, useState, type FormEvent } from 'react';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { adicionarDominioSeguro } from '../lib/scraperConfig';

const MENSAGEM_RESULTADO_DOMINIO: Record<string, string> = {
  ja_aprovado: 'Already an approved domain — nothing to do.',
  ativado: 'Domain reactivated and approved.',
  criado: 'Domain added and approved.',
};

/** Inserção manual de domínio seguro direto na página de Updates (handout consolidado C5). */
export function AdicionarDominioManual() {
  const [valor, setValor] = useState('');
  const [mensagem, setMensagem] = useState<string | null>(null);

  const { executar: submeter, executando: enviando, erro } = useAsyncAction(
    useCallback(async (entrada: string) => {
      const resultado = await adicionarDominioSeguro(entrada);
      setMensagem(MENSAGEM_RESULTADO_DOMINIO[resultado]);
      setValor('');
    }, [])
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const entrada = valor.trim();
    if (!entrada) return;
    setMensagem(null);
    await submeter(entrada);
  }

  return (
    <form className="adicionar-dominio-form" onSubmit={handleSubmit}>
      <input
        type="text"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder="domain.com or https://domain.com/…"
        disabled={enviando}
      />
      <button type="submit" disabled={enviando || !valor.trim()}>
        {enviando ? 'Please wait…' : 'Add safe domain'}
      </button>
      {mensagem && (
        <p className="execucao-status execucao-ok">
          <strong>{mensagem}</strong>
        </p>
      )}
      {erro && <p className="execucao-status execucao-erro">{erro}</p>}
    </form>
  );
}
