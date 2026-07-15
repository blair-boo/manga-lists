import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { db } from '../db/localDb';
import { ObraCard } from '../components/ObraCard';
import { TagPicker } from '../components/TagPicker';
import { useListasPorCategoria } from '../hooks/useListas';
import { capitulosAtrasados, temNovoCapitulo } from '../lib/obra';
import type { Fonte, Obra } from '../types';

type ViewMode = 'grid' | 'list';
type Ordenacao = 'titulo' | 'atualizado' | 'nota' | 'atrasados' | 'criado';

const ORDENACOES: { valor: Ordenacao; rotulo: string }[] = [
  { valor: 'titulo', rotulo: 'Title (A–Z)' },
  { valor: 'atualizado', rotulo: 'Recently updated' },
  { valor: 'atrasados', rotulo: 'Most chapters behind' },
  { valor: 'nota', rotulo: 'Highest rating' },
  { valor: 'criado', rotulo: 'Recently added' },
];

function lerViewModeSalvo(): ViewMode {
  return localStorage.getItem('viewMode') === 'list' ? 'list' : 'grid';
}

function lerOrdenacaoSalva(): Ordenacao {
  const v = localStorage.getItem('ordenacao');
  return ORDENACOES.some((o) => o.valor === v) ? (v as Ordenacao) : 'titulo';
}

function comparar(a: Obra, b: Obra, ordem: Ordenacao): number {
  switch (ordem) {
    case 'atualizado':
      return (b.atualizado_em ?? '').localeCompare(a.atualizado_em ?? '');
    case 'criado':
      return (b.criado_em ?? '').localeCompare(a.criado_em ?? '');
    case 'nota':
      return (b.nota ?? -1) - (a.nota ?? -1) || a.titulo.localeCompare(b.titulo);
    case 'atrasados':
      return capitulosAtrasados(b) - capitulosAtrasados(a) || a.titulo.localeCompare(b.titulo);
    default:
      return a.titulo.localeCompare(b.titulo);
  }
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
  const [generosSel, setGenerosSel] = useState<string[]>([]);
  const [tagsSel, setTagsSel] = useState<string[]>([]);
  const [soNovoCapitulo, setSoNovoCapitulo] = useState(false);
  const [soUnsourced, setSoUnsourced] = useState(false);
  const [ordenacao, setOrdenacao] = useState<Ordenacao>(lerOrdenacaoSalva);
  const [viewMode, setViewMode] = useState<ViewMode>(lerViewModeSalvo);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);

  function alternarViewMode(modo: ViewMode) {
    setViewMode(modo);
    localStorage.setItem('viewMode', modo);
  }

  function alternarOrdenacao(ordem: Ordenacao) {
    setOrdenacao(ordem);
    localStorage.setItem('ordenacao', ordem);
  }

  function alternarStatusChip(valor: string) {
    setStatusLeitura((atual) => (atual === valor ? '' : valor));
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

  const contagemStatus = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of obras ?? []) {
      if (o.status_leitura) map.set(o.status_leitura, (map.get(o.status_leitura) ?? 0) + 1);
    }
    return map;
  }, [obras]);

  const contagemNovoCapitulo = useMemo(
    () => (obras ?? []).filter(temNovoCapitulo).length,
    [obras]
  );

  const semFonte = useMemo(
    () => (o: Obra) => (fontesPorObra.get(o.id)?.length ?? 0) === 0,
    [fontesPorObra]
  );

  const contagemUnsourced = useMemo(
    () => (obras ?? []).filter(semFonte).length,
    [obras, semFonte]
  );

  const filtradas = useMemo(() => {
    if (!obras) return [];
    const buscaLower = busca.trim().toLowerCase();
    return obras
      .filter((o) => !buscaLower || o.titulo.toLowerCase().includes(buscaLower))
      .filter((o) => !tipo || o.tipo === tipo)
      .filter((o) => !statusLeitura || o.status_leitura === statusLeitura)
      .filter((o) => !statusPublicacao || o.status_publicacao === statusPublicacao)
      .filter((o) => generosSel.every((g) => (o.generos ?? []).includes(g)))
      .filter((o) => tagsSel.every((t) => (o.tags ?? []).includes(t)))
      .filter((o) => !soNovoCapitulo || temNovoCapitulo(o))
      .filter((o) => !soUnsourced || semFonte(o))
      .sort((a, b) => comparar(a, b, ordenacao));
  }, [obras, busca, tipo, statusLeitura, statusPublicacao, generosSel, tagsSel, soNovoCapitulo, soUnsourced, semFonte, ordenacao]);

  const temFiltroAtivo =
    !!busca ||
    !!tipo ||
    !!statusLeitura ||
    !!statusPublicacao ||
    generosSel.length > 0 ||
    tagsSel.length > 0 ||
    soNovoCapitulo ||
    soUnsourced;

  function limparFiltros() {
    setBusca('');
    setTipo('');
    setStatusLeitura('');
    setStatusPublicacao('');
    setGenerosSel([]);
    setTagsSel([]);
    setSoNovoCapitulo(false);
    setSoUnsourced(false);
  }

  const carregando = obras === undefined;
  const acervoVazio = !carregando && obras.length === 0;

  return (
    <div className="lista-principal">
      <input
        type="search"
        placeholder="Search by title…"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        className="busca-topo"
      />

      <div className="status-chips">
        <button
          type="button"
          className={`status-chip status-chip-novo ${soNovoCapitulo ? 'ativo' : ''}`}
          onClick={() => setSoNovoCapitulo((v) => !v)}
        >
          New chapters
          <span className="status-chip-contagem">{contagemNovoCapitulo}</span>
        </button>
        {statusLeituraOpcoes.map((v) => (
          <button
            key={v}
            type="button"
            className={`status-chip ${statusLeitura === v ? 'ativo' : ''}`}
            onClick={() => alternarStatusChip(v)}
          >
            {v}
            <span className="status-chip-contagem">{contagemStatus.get(v) ?? 0}</span>
          </button>
        ))}
        <button
          type="button"
          className={`status-chip status-chip-unsourced ${soUnsourced ? 'ativo' : ''}`}
          onClick={() => setSoUnsourced((v) => !v)}
        >
          Unsourced
          <span className="status-chip-contagem">{contagemUnsourced}</span>
        </button>
      </div>

      <div className="filtros-toggle-row">
        <button
          type="button"
          className="filtros-toggle"
          onClick={() => setFiltrosAbertos((v) => !v)}
          aria-expanded={filtrosAbertos}
        >
          {filtrosAbertos ? 'Hide filters' : 'Filters'}
          {temFiltroAtivo && <span className="filtros-toggle-dot" />}
        </button>
        {temFiltroAtivo && (
          <button type="button" className="filtros-limpar" onClick={limparFiltros}>
            Clear filters
          </button>
        )}
      </div>

      {filtrosAbertos && (
        <div className="filtros filtros-aberto">
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Type (all)</option>
            {tipos.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <select value={statusLeitura} onChange={(e) => setStatusLeitura(e.target.value)}>
            <option value="">Reading status (all)</option>
            {statusLeituraOpcoes.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <select value={statusPublicacao} onChange={(e) => setStatusPublicacao(e.target.value)}>
            <option value="">Publication status (all)</option>
            {statusPublicacaoOpcoes.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <TagPicker label="Genres" value={generosSel} options={generos} onChange={setGenerosSel} />
          <TagPicker label="Tags" value={tagsSel} options={tags} onChange={setTagsSel} />
        </div>
      )}

      <div className="lista-principal-toolbar">
        <p className="contagem-resultados">
          {filtradas.length} work{filtradas.length === 1 ? '' : 's'}
        </p>
        <div className="toolbar-direita">
          <label className="ordenacao-controle">
            Sort:
            <select value={ordenacao} onChange={(e) => alternarOrdenacao(e.target.value as Ordenacao)}>
              {ORDENACOES.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.rotulo}
                </option>
              ))}
            </select>
          </label>
          <div className="view-toggle">
            <button
              type="button"
              className={viewMode === 'grid' ? 'ativo' : ''}
              onClick={() => alternarViewMode('grid')}
              aria-label="Grid view"
            >
              Grid
            </button>
            <button
              type="button"
              className={viewMode === 'list' ? 'ativo' : ''}
              onClick={() => alternarViewMode('list')}
              aria-label="List view"
            >
              List
            </button>
          </div>
        </div>
      </div>

      {carregando ? (
        <div className="grid-obras">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="obra-card-skeleton" />
          ))}
        </div>
      ) : filtradas.length === 0 ? (
        <div className="lista-vazia">
          {acervoVazio ? (
            <p>No works added yet. Start from the Add tab.</p>
          ) : (
            <>
              <p>No works match the filters.</p>
              {temFiltroAtivo && (
                <button type="button" onClick={limparFiltros}>
                  Clear filters
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <div className={`grid-obras ${viewMode === 'list' ? 'list-view' : ''}`}>
          {filtradas.map((obra) => (
            <ObraCard key={obra.id} obra={obra} fontes={fontesPorObra.get(obra.id) ?? []} />
          ))}
        </div>
      )}
    </div>
  );
}
