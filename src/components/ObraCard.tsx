import { Link } from 'react-router-dom';
import { StatusScraper } from './StatusScraper';
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
          {obra.tipo && <span className="badge">{obra.tipo}</span>}
          {obra.status_leitura && <span className="badge badge-status">{obra.status_leitura}</span>}
        </div>
        <div className="obra-card-progresso">
          ch. {obra.capitulo_atual ?? '—'}
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
                {f.ultimo_capitulo_detectado != null && <span> · cap. {f.ultimo_capitulo_detectado}</span>}
                <StatusScraper fonte={f} compact />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
