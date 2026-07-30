import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../db/localDb';
import { salvarBusca } from '../lib/filtrosLista';

interface Props {
  value: string;
  onChange: (texto: string) => void;
  /** Renderizado na mesma linha, à direita do campo. Usado pelo Clear filters (Bloco D). */
  acaoDireita?: ReactNode;
}

/**
 * Busca de título compartilhada entre a lista e a tela da obra, com sugestões
 * conforme se digita. Mesmo padrão de dropdown de VinculoObraSelect/TagPicker
 * (sem <datalist>, que o Safari iOS não abre de forma confiável).
 */
export function BuscaObras({ value, onChange, acaoDireita }: Props) {
  const obras = useLiveQuery(() => db.obras.toArray(), []);
  const [aberto, setAberto] = useState(false);
  const navigate = useNavigate();

  const sugestoes = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    return (obras ?? [])
      .filter(
        (o) =>
          o.titulo.toLowerCase().includes(q) ||
          (o.titulos_alternativos ?? []).some((t) => t.toLowerCase().includes(q))
      )
      .sort((a, b) => a.titulo.localeCompare(b.titulo))
      .slice(0, 10);
  }, [obras, value]);

  return (
    <div className="busca-linha">
      <div className="busca-input-wrap">
        <input
          type="search"
          placeholder="Search by title…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setAberto(true)}
          onBlur={() => setTimeout(() => setAberto(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setAberto(false);
          }}
          className="busca-topo"
        />
        {aberto && sugestoes.length > 0 && (
          <ul className="busca-sugestoes">
            {sugestoes.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    // Grava direto no localStorage (não só via onChange): a
                    // navegação que segue troca de rota no mesmo tick, e o
                    // React pode descartar o estado do componente que perderia
                    // a montagem antes do efeito de persistência da lista rodar.
                    salvarBusca('');
                    onChange('');
                    navigate(`/obra/${o.id}`);
                  }}
                >
                  {o.titulo} {o.tipo ? `(${o.tipo})` : ''}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {acaoDireita}
    </div>
  );
}
