import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { db } from '../db/localDb';
import { ObraCard } from '../components/ObraCard';
import { useListasPorCategoria } from '../hooks/useListas';
import type { Fonte } from '../types';

type ViewMode = 'grid' | 'list';

function lerViewModeSalvo(): ViewMode {
  return localStorage.getItem('viewMode') === 'list' ? 'list' : 'grid';
}

export function ListaPrincipalPage() {
  const obras = useLiveQuery(() => db.obras.toArray(), []);
  const fontes = useLiveQuery(() => db.fontes.toArray(), []);
  const tipos = useListasPorCategoria('tipo');
  const statusLeituraOpcoes = useListasPorCategoria('status_leitura');
  const statusPublicacaoOpcoes = useListasPorCategoria('status_publicacao');
  const generos = useListasPorCategoria('genero');
  const tags = useListasPorCategoria('tag');

  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState('');
  const [statusLeitura, setStatusLeitura] = useState('');
  const [statusPublicacao, setStatusPublicacao] = useState('');
  const [genero, setGenero] = useState('');
  const [tag, setTag] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>(lerViewModeSalvo);

  function alternarViewMode(modo: ViewMode) {
    setViewMode(modo);
    localStorage.setItem('viewMode', modo);
  }

  const fontesPorObra = useMemo(() => {
    const map = new Map<string, Fonte[]>();
    for (const f of fontes ?? []) {
      const lista = map.get(f.obra_id) ?? [];
      lista.push(f);
      map.set(f.obra_id, lista);
    }
    return map;
  }, [fontes]);

  const filtradas = useMemo(() => {
    if (!obras) return [];
    const buscaLower = busca.trim().toLowerCase();
    return obras
      .filter((o) => !buscaLower || o.titulo.toLowerCase().includes(buscaLower))
      .filter((o) => !tipo || o.tipo === tipo)
      .filter((o) => !statusLeitura || o.status_leitura === statusLeitura)
      .filter((o) => !statusPublicacao || o.status_publicacao === statusPublicacao)
      .filter((o) => !genero || (o.generos ?? []).includes(genero))
      .filter((o) => !tag || (o.tags ?? []).includes(tag))
      .sort((a, b) => a.titulo.localeCompare(b.titulo));
  }, [obras, busca, tipo, statusLeitura, statusPublicacao, genero, tag]);

  function limparFiltros() {
    setBusca('');
    setTipo('');
    setStatusLeitura('');
    setStatusPublicacao('');
    setGenero('');
    setTag('');
  }

  return (
    <div className="lista-principal">
      <div className="filtros">
        <input
          type="search"
          placeholder="Buscar por título…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="filtro-busca"
        />
        <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="">Tipo (todos)</option>
          {tipos.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select value={statusLeitura} onChange={(e) => setStatusLeitura(e.target.value)}>
          <option value="">Status de leitura (todos)</option>
          {statusLeituraOpcoes.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select value={statusPublicacao} onChange={(e) => setStatusPublicacao(e.target.value)}>
          <option value="">Status de publicação (todos)</option>
          {statusPublicacaoOpcoes.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select value={genero} onChange={(e) => setGenero(e.target.value)}>
          <option value="">Gênero (todos)</option>
          {generos.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">Tag (todas)</option>
          {tags.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <button type="button" onClick={limparFiltros}>
          Limpar filtros
        </button>
      </div>

      <div className="lista-principal-toolbar">
        <p className="contagem-resultados">
          {filtradas.length} obra{filtradas.length === 1 ? '' : 's'}
        </p>
        <div className="view-toggle">
          <button
            type="button"
            className={viewMode === 'grid' ? 'ativo' : ''}
            onClick={() => alternarViewMode('grid')}
            aria-label="Ver em grade"
          >
            Grade
          </button>
          <button
            type="button"
            className={viewMode === 'list' ? 'ativo' : ''}
            onClick={() => alternarViewMode('list')}
            aria-label="Ver em lista"
          >
            Lista
          </button>
        </div>
      </div>

      <div className={`grid-obras ${viewMode === 'list' ? 'list-view' : ''}`}>
        {filtradas.map((obra) => (
          <ObraCard key={obra.id} obra={obra} fontes={fontesPorObra.get(obra.id) ?? []} />
        ))}
      </div>
    </div>
  );
}
