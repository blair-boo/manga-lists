import { Link } from 'react-router-dom';
import { StatusScraper } from './StatusScraper';
import type { Fonte, Obra } from '../types';

function Estrelas({ nota }: { nota: number | null }) {
  if (!nota) return null;
  return <span className="estrelas">{'★'.repeat(nota)}{'☆'.repeat(5 - nota)}</span>;
}

export function ObraCard({ obra, fontes }: { obra: Obra; fontes: Fonte[] }) {
  const temNovoCapitulo =
    obra.ultimo_capitulo_via_scraper &&
    obra.ultimo_capitulo_lancado != null &&
    obra.capitulo_atual != null &&
    obra.ultimo_capitulo_lancado > obra.capitulo_atual;

  return (
    <div className="obra-card">
      <div className="obra-card-capa">
        {obra.capa_url ? (
          <img src={obra.capa_url} alt="" loading="lazy" />
        ) : (
          <div className="obra-card-capa-placeholder">{obra.titulo.slice(0, 1).toUpperCase()}</div>
        )}
        {temNovoCapitulo && <span className="badge-novo-capitulo">novo cap.</span>}
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
          cap. {obra.capitulo_atual ?? '—'}
          {obra.ultimo_capitulo_lancado != null && ` / ${obra.ultimo_capitulo_lancado} disponível`}
        </div>
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
