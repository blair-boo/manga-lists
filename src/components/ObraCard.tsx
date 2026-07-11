import { Link } from 'react-router-dom';
import type { Obra } from '../types';

function Estrelas({ nota }: { nota: number | null }) {
  if (!nota) return null;
  return <span className="estrelas">{'★'.repeat(nota)}{'☆'.repeat(5 - nota)}</span>;
}

export function ObraCard({ obra }: { obra: Obra }) {
  const temNovoCapitulo =
    obra.ultimo_capitulo_lancado != null &&
    obra.capitulo_atual != null &&
    obra.ultimo_capitulo_lancado > obra.capitulo_atual;

  return (
    <Link to={`/obra/${obra.id}`} className="obra-card">
      <div className="obra-card-capa">
        {obra.capa_url ? (
          <img src={obra.capa_url} alt="" loading="lazy" />
        ) : (
          <div className="obra-card-capa-placeholder">{obra.titulo.slice(0, 1).toUpperCase()}</div>
        )}
        {temNovoCapitulo && <span className="badge-novo-capitulo">novo cap.</span>}
      </div>
      <div className="obra-card-info">
        <strong className="obra-card-titulo">{obra.titulo}</strong>
        <div className="obra-card-meta">
          {obra.tipo && <span className="badge">{obra.tipo}</span>}
          {obra.status_leitura && <span className="badge badge-status">{obra.status_leitura}</span>}
        </div>
        <div className="obra-card-progresso">
          cap. {obra.capitulo_atual ?? '—'}
          {obra.ultimo_capitulo_lancado != null && ` / ${obra.ultimo_capitulo_lancado} disponível`}
        </div>
        <Estrelas nota={obra.nota} />
      </div>
    </Link>
  );
}
