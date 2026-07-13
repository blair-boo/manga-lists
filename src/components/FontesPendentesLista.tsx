import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../db/localDb';
import { setFonteAprovacao } from '../db/repo';

export function FontesPendentesLista() {
  const fontes = useLiveQuery(() => db.fontes.where('status_aprovacao').equals('pendente').toArray(), []);
  const obras = useLiveQuery(() => db.obras.toArray(), []);

  const grupos = useMemo(() => {
    if (!fontes || !obras) return [];
    const obraPorId = new Map(obras.map((o) => [o.id, o]));
    const porObra = new Map<string, typeof fontes>();
    for (const f of fontes) {
      const lista = porObra.get(f.obra_id) ?? [];
      lista.push(f);
      porObra.set(f.obra_id, lista);
    }
    return Array.from(porObra.entries())
      .map(([obraId, lista]) => ({ obra: obraPorId.get(obraId), fontes: lista }))
      .filter((g) => g.obra)
      .sort((a, b) => a.obra!.titulo.localeCompare(b.obra!.titulo));
  }, [fontes, obras]);

  if (fontes === undefined || obras === undefined) return <p>Carregando…</p>;

  return (
    <div className="fontes-pendentes">
      {grupos.length === 0 && <p>Nenhuma fonte pendente. O scraper avisa aqui quando encontrar uma fonte nova.</p>}
      {grupos.map(({ obra, fontes: lista }) => (
        <div key={obra!.id} className="fontes-pendentes-grupo">
          <Link to={`/obra/${obra!.id}`} className="fontes-pendentes-titulo">
            {obra!.titulo}
          </Link>
          <ul>
            {lista.map((f) => (
              <li key={f.id} className="fonte-item">
                <a href={f.url} target="_blank" rel="noreferrer">
                  {f.site || f.url}
                </a>
                {f.ultimo_capitulo_detectado != null && <span>cap. {f.ultimo_capitulo_detectado}</span>}
                {f.descoberta_automaticamente && <span className="badge">descoberta automática</span>}
                <div className="fonte-acoes">
                  <button type="button" onClick={() => setFonteAprovacao(f.id, 'aprovado')}>
                    Aprovar
                  </button>
                  <button type="button" onClick={() => setFonteAprovacao(f.id, 'rejeitado')}>
                    Rejeitar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
