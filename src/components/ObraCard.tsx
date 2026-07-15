import { useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { StatusScraper } from './StatusScraper';
import { updateObra } from '../db/repo';
import { temNovoCapitulo } from '../lib/obra';
import type { Fonte, Obra } from '../types';

function Estrelas({ nota }: { nota: number | null }) {
  if (!nota) return null;
  return <span className="estrelas">{'★'.repeat(nota)}{'☆'.repeat(5 - nota)}</span>;
}

function ProgressoBarra({ obra }: { obra: Obra }) {
  if (obra.ultimo_capitulo_lancado == null || obra.ultimo_capitulo_lancado <= 0) return null;
  const atual = obra.capitulo_atual ?? 0;
  const pct = Math.min(100, Math.max(0, (atual / obra.ultimo_capitulo_lancado) * 100));
  return (
    <div
      className="obra-card-barra"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={obra.ultimo_capitulo_lancado}
      aria-valuenow={atual}
    >
      <div className="obra-card-barra-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Edição inline do capítulo lido (capitulo_atual) direto na lista, sem abrir o formulário. */
function CapituloAtualEditavel({ obra }: { obra: Obra }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');

  function abrir() {
    setValor(obra.capitulo_atual != null ? String(obra.capitulo_atual) : '');
    setEditando(true);
  }

  async function salvar() {
    const bruto = valor.trim();
    const novo = bruto === '' ? null : Number(bruto);
    if (novo !== null && Number.isNaN(novo)) {
      setEditando(false);
      return;
    }
    if (novo !== obra.capitulo_atual) {
      await updateObra(obra.id, { capitulo_atual: novo });
    }
    setEditando(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') void salvar();
    else if (e.key === 'Escape') setEditando(false);
  }

  if (editando) {
    return (
      <input
        className="cap-atual-input"
        type="number"
        step="any"
        autoFocus
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={salvar}
      />
    );
  }

  return (
    <button type="button" className="cap-atual-botao" onClick={abrir} title="Edit current chapter">
      ch. {obra.capitulo_atual ?? '—'}
    </button>
  );
}

export function ObraCard({ obra, fontes }: { obra: Obra; fontes: Fonte[] }) {
  const novoCapitulo = temNovoCapitulo(obra);

  return (
    <div className="obra-card">
      <div className="obra-card-capa" data-tipo={obra.tipo ?? ''}>
        {obra.capa_url ? (
          <img src={obra.capa_url} alt="" loading="lazy" />
        ) : (
          <div className="obra-card-capa-placeholder">{obra.titulo.slice(0, 1).toUpperCase()}</div>
        )}
        {novoCapitulo && <span className="badge-novo-capitulo">new ch.</span>}
      </div>
      <div className="obra-card-info">
        <Link to={`/obra/${obra.id}`} className="obra-card-titulo">
          {obra.titulo}
        </Link>
        <div className="obra-card-meta">
          {obra.status_publicacao && <span className="badge badge-pub">{obra.status_publicacao}</span>}
          {obra.fim_de_temporada && <span className="badge badge-eos">End of Season</span>}
          {obra.tipo && <span className="badge">{obra.tipo}</span>}
          {obra.status_leitura && <span className="badge badge-status">{obra.status_leitura}</span>}
        </div>
        <div className="obra-card-progresso">
          <CapituloAtualEditavel obra={obra} />
          {obra.ultimo_capitulo_lancado != null && ` / ${obra.ultimo_capitulo_lancado} available`}
        </div>
        <ProgressoBarra obra={obra} />
        <Estrelas nota={obra.nota} />

        {fontes.length > 0 && (
          <ul className="obra-card-fontes">
            {fontes.map((f) => (
              <li key={f.id}>
                <a href={f.url} target="_blank" rel="noreferrer">
                  {f.site || f.url}
                </a>
                {f.ultimo_capitulo_detectado != null && <span> · ch. {f.ultimo_capitulo_detectado}</span>}
                <StatusScraper fonte={f} compact />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
