import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { db } from '../db/localDb';
import { ObraCard } from '../components/ObraCard';
import { useListasPorCategoria } from '../hooks/useListas';

export function ListaPrincipalPage() {
  const obras = useLiveQuery(() => db.obras.toArray(), []);
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

      <p className="contagem-resultados">
        {filtradas.length} obra{filtradas.length === 1 ? '' : 's'}
      </p>

      <div className="grid-obras">
        {filtradas.map((obra) => (
          <ObraCard key={obra.id} obra={obra} />
        ))}
      </div>
    </div>
  );
}
