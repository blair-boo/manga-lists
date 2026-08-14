import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { db } from '../db/localDb';
import type { Obra } from '../types';

interface Props {
  /** Obra atual, pra excluir da lista de opções (evita auto-vínculo). Null quando ainda não foi criada. */
  excluirId?: string | null;
  /** Restringe as opções (ex.: só Novels ainda não inscritas no Reader). Sem isso, oferece todas. */
  filtrar?: (obra: Obra) => boolean;
  value: string;
  onChange: (obraId: string) => void;
  placeholder?: string;
}

/**
 * Busca de título com autocomplete (digitar pra filtrar, clicar numa
 * sugestão pra selecionar) pra vincular uma obra já cadastrada como
 * manga<->novel da mesma história (handout de scrapers/ajustes B1). Mesmo
 * padrão de dropdown de sugestões do TagPicker (sem <datalist>, que o Safari
 * iOS não abre de forma confiável).
 */
export function VinculoObraSelect({ excluirId, filtrar, value, onChange, placeholder }: Props) {
  const obras = useLiveQuery(() => db.obras.toArray(), []);
  const [query, setQuery] = useState('');
  const [aberto, setAberto] = useState(false);

  const selecionada = useMemo(() => (obras ?? []).find((o) => o.id === value) ?? null, [obras, value]);

  const sugestoes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (obras ?? [])
      .filter(
        (o) =>
          o.id !== excluirId &&
          (!filtrar || filtrar(o)) &&
          (!q ||
            o.titulo.toLowerCase().includes(q) ||
            (o.titulos_alternativos ?? []).some((t) => t.toLowerCase().includes(q)))
      )
      .sort((a, b) => a.titulo.localeCompare(b.titulo))
      .slice(0, 8);
  }, [obras, excluirId, filtrar, query]);

  if (selecionada) {
    return (
      <div className="vinculo-busca">
        <span className="vinculo-busca-selecionada">
          {selecionada.titulo} {selecionada.tipo ? `(${selecionada.tipo})` : ''}
        </span>
        <button
          type="button"
          onClick={() => {
            onChange('');
            setQuery('');
          }}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="vinculo-busca">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setAberto(true)}
        onBlur={() => setTimeout(() => setAberto(false), 120)}
        placeholder={placeholder ?? 'Search a title…'}
        autoComplete="off"
      />
      {aberto && sugestoes.length > 0 && (
        <ul className="vinculo-busca-sugestoes">
          {sugestoes.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(o.id);
                  setQuery('');
                }}
              >
                {o.titulo} {o.tipo ? `(${o.tipo})` : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
