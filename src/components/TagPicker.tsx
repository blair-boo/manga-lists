import { useMemo, useState, type KeyboardEvent } from 'react';

interface TagPickerProps {
  label: string;
  value: string[];
  options: string[];
  onChange: (novoValor: string[]) => void;
}

// Dropdown de sugestões próprio (em vez de <datalist>, que o Safari iOS não abre
// de forma confiável). Posicionado num container relativo, sem position:fixed.
export function TagPicker({ label, value, options, onChange }: TagPickerProps) {
  const [input, setInput] = useState('');
  const [aberto, setAberto] = useState(false);

  const sugestoes = useMemo(() => {
    const q = input.trim().toLowerCase();
    const selecionados = new Set(value);
    return options.filter((o) => !selecionados.has(o) && (!q || o.toLowerCase().includes(q))).slice(0, 8);
  }, [options, value, input]);

  function adicionar(explicito?: string) {
    const v = (explicito ?? input).trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setInput('');
  }

  function remover(item: string) {
    onChange(value.filter((v) => v !== item));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      adicionar();
    } else if (e.key === 'Escape') {
      setAberto(false);
    }
  }

  return (
    <div className="tag-picker">
      <span className="tag-picker-label">{label}</span>
      <div className="tag-picker-chips">
        {value.map((item) => (
          <span key={item} className="tag-chip">
            {item}
            <button type="button" onClick={() => remover(item)} aria-label={`Remove ${item}`}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="tag-picker-input-wrap">
        <div className="tag-picker-input-row">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setAberto(true)}
            onBlur={() => setTimeout(() => setAberto(false), 120)}
            placeholder={`Add ${label.toLowerCase()}…`}
            autoComplete="off"
          />
          <button type="button" onClick={() => adicionar()}>
            Add
          </button>
        </div>
        {aberto && sugestoes.length > 0 && (
          <ul className="tag-picker-sugestoes">
            {sugestoes.map((o) => (
              <li key={o}>
                <button
                  type="button"
                  // onMouseDown (com preventDefault) dispara antes do blur do input,
                  // então o clique registra sem o dropdown fechar antes.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    adicionar(o);
                  }}
                >
                  {o}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
