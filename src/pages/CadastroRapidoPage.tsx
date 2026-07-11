import { useState, type FormEvent } from 'react';
import { cadastroRapido } from '../db/repo';
import { useListasPorCategoria } from '../hooks/useListas';
import type { Tipo } from '../types';

export function CadastroRapidoPage() {
  const tipos = useListasPorCategoria('tipo');
  const [texto, setTexto] = useState('');
  const [tipoPadrao, setTipoPadrao] = useState('');
  const [resultado, setResultado] = useState<{ criadas: string[]; jaExistiam: string[] } | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const linhas = texto.split('\n').map((l) => l.trim()).filter(Boolean);
    if (linhas.length === 0) return;
    setSalvando(true);
    const r = await cadastroRapido(linhas, (tipoPadrao || null) as Tipo | null);
    setSalvando(false);
    setResultado(r);
    setTexto('');
  }

  return (
    <div className="cadastro-rapido">
      <h2>Cadastro rápido</h2>
      <p>Cole um título por linha. Títulos que já existem (comparação sem diferenciar maiúsculas/minúsculas) não são duplicados.</p>
      <form onSubmit={handleSubmit}>
        <label>
          Tipo padrão (opcional, aplicado a todos os títulos desta leva)
          <select value={tipoPadrao} onChange={(e) => setTipoPadrao(e.target.value)}>
            <option value="">—</option>
            {tipos.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={12}
          placeholder={'Título 1\nTítulo 2\nTítulo 3'}
        />
        <button type="submit" disabled={salvando}>
          {salvando ? 'Salvando…' : 'Cadastrar'}
        </button>
      </form>

      {resultado && (
        <div className="cadastro-rapido-resultado">
          <p>
            {resultado.criadas.length} obra{resultado.criadas.length === 1 ? '' : 's'} criada
            {resultado.criadas.length === 1 ? '' : 's'}.
          </p>
          {resultado.jaExistiam.length > 0 && (
            <div>
              <p>Já existiam (não duplicadas):</p>
              <ul>
                {resultado.jaExistiam.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
