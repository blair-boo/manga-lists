import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/localDb';

interface Props {
  /** Obra atual, pra excluir da lista de opções (evita auto-vínculo). Null quando ainda não foi criada. */
  excluirId?: string | null;
  value: string;
  onChange: (obraId: string) => void;
}

/**
 * Busca/seleção de uma obra já cadastrada pra vincular como manga<->novel da
 * mesma história (handout consolidado, Bloco B3). Lista simples por título —
 * biblioteca pessoal, poucas dezenas/centenas de itens.
 */
export function VinculoObraSelect({ excluirId, value, onChange }: Props) {
  const obras = useLiveQuery(() => db.obras.toArray(), []);
  const opcoes = (obras ?? [])
    .filter((o) => o.id !== excluirId)
    .sort((a, b) => a.titulo.localeCompare(b.titulo));

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select a work…</option>
      {opcoes.map((o) => (
        <option key={o.id} value={o.id}>
          {o.titulo} {o.tipo ? `(${o.tipo})` : ''}
        </option>
      ))}
    </select>
  );
}
