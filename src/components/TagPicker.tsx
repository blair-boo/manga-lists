import { useId, useState, type KeyboardEvent } from 'react';

interface TagPickerProps {
  label: string;
  value: string[];
  options: string[];
  onChange: (novoValor: string[]) => void;
}

export function TagPicker({ label, value, options, onChange }: TagPickerProps) {
  const [input, setInput] = useState('');
  const datalistId = useId();

  function adicionar() {
    const v = input.trim();
    if (!v || value.includes(v)) {
      setInput('');
      return;
    }
    onChange([...value, v]);
    setInput('');
  }

  function remover(item: string) {
    onChange(value.filter((v) => v !== item));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      adicionar();
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
      <div className="tag-picker-input-row">
        <input
          list={datalistId}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Add ${label.toLowerCase()}…`}
        />
        <datalist id={datalistId}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <button type="button" onClick={adicionar}>
          Add
        </button>
      </div>
    </div>
  );
}
