import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { db } from '../db/localDb';
import { ObraCard } from '../components/ObraCard';
import { TagPicker } from '../components/TagPicker';
import { useListasPorCategoria } from '../hooks/useListas';
import { useSitesAtivos } from '../hooks/useSitesAtivos';
import { familiaDeTipo, temNovoCapitulo } from '../lib/obra';
import {
  FILTROS_KEY,
  ORDENACOES,
  lerFiltrosSalvos,
  lerOrdenacaoSalva,
  obrasFiltradasOrdenadas,
  proximoEstadoFiltro,
  type EstadoFiltro,
  type FiltrosSalvos,
  type Ordenacao,
} from '../lib/filtrosLista';
import type { Fonte, Obra } from '../types';

type ViewMode = 'grid' | 'list';

function classeEstadoFiltro(estado: EstadoFiltro): string {
  if (estado === 'incluir') return 'ativo';
  if (estado === 'excluir') return 'excluido';
  return '';
}

function tituloEstadoFiltro(estado: EstadoFiltro): string {
  if (estado === 'incluir') return 'Showing only these — click to exclude instead';
  if (estado === 'excluir') return 'Hiding these — click to clear';
  return 'Click to show only these';
}

function lerViewModeSalvo(): ViewMode {
  return localStorage.getItem('viewMode') === 'list' ? 'list' : 'grid';
}

/** Posição de scroll da lista, restaurada quando se volta da tela da obra. */
const SCROLL_KEY = 'listaScrollY';

export function ListaPrincipalPage() {
  const obras = useLiveQuery(() => db.obras.toArray(), []);
  const fontes = useLiveQuery(() => db.fontes.toArray(), []);
  const sitesAtivos = useSitesAtivos();
  const tipos = useListasPorCategoria('tipo');
  const statusLeituraOpcoes = useListasPorCategoria('status_leitura');
  const statusPublicacaoOpcoes = useListasPorCategoria('status_publicacao');
  const generos = useListasPorCategoria('genero');
  const tags = useListasPorCategoria('tag');

  const [busca, setBusca] = useState(() => lerFiltrosSalvos().busca);
  const [tipo, setTipo] = useState(() => lerFiltrosSalvos().tipo);
  const [statusLeituraFiltros, setStatusLeituraFiltros] = useState<Record<string, EstadoFiltro>>(
    () => lerFiltrosSalvos().statusLeituraFiltros
  );
  const [statusPublicacao, setStatusPublicacao] = useState(() => lerFiltrosSalvos().statusPublicacao);
  const [generosSel, setGenerosSel] = useState<string[]>(() => lerFiltrosSalvos().generosSel);
  const [tagsSel, setTagsSel] = useState<string[]>(() => lerFiltrosSalvos().tagsSel);
  const [filtroNovoCapitulo, setFiltroNovoCapitulo] = useState<EstadoFiltro>(
    () => lerFiltrosSalvos().filtroNovoCapitulo
  );
  const [filtroNovel, setFiltroNovel] = useState<EstadoFiltro>(() => lerFiltrosSalvos().filtroNovel);
  const [filtroUnsourced, setFiltroUnsourced] = useState<EstadoFiltro>(() => lerFiltrosSalvos().filtroUnsourced);
  const [ordenacao, setOrdenacao] = useState<Ordenacao>(lerOrdenacaoSalva);
  const [viewMode, setViewMode] = useState<ViewMode>(lerViewModeSalvo);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);

  // Persiste os filtros a cada mudança — só somem de fato ao clicar "Clear
  // filters" (limparFiltros), mesmo saindo da tela e voltando depois.
  useEffect(() => {
    const dados: FiltrosSalvos = {
      busca,
      tipo,
      statusLeituraFiltros,
      statusPublicacao,
      generosSel,
      tagsSel,
      filtroNovoCapitulo,
      filtroNovel,
      filtroUnsourced,
    };
    localStorage.setItem(FILTROS_KEY, JSON.stringify(dados));
  }, [
    busca,
    tipo,
    statusLeituraFiltros,
    statusPublicacao,
    generosSel,
    tagsSel,
    filtroNovoCapitulo,
    filtroNovel,
    filtroUnsourced,
  ]);

  function alternarViewMode(modo: ViewMode) {
    setViewMode(modo);
    localStorage.setItem('viewMode', modo);
  }

  function alternarOrdenacao(ordem: Ordenacao) {
    setOrdenacao(ordem);
    localStorage.setItem('ordenacao', ordem);
  }

  function alternarStatusChip(valor: string) {
    setStatusLeituraFiltros((atual) => ({
      ...atual,
      [valor]: proximoEstadoFiltro(atual[valor] ?? 'off'),
    }));
  }

  // Dropdown "Reading status (all)" no painel de Filters: continua um seletor
  // único (sem noção de excluir), então só reflete/produz o caso em que
  // exatamente um chip está em 'incluir' e nenhum está em 'excluir'.
  const statusLeituraDropdownValor = useMemo(() => {
    const incluidos = Object.entries(statusLeituraFiltros)
      .filter(([, v]) => v === 'incluir')
      .map(([k]) => k);
    const temExcluido = Object.values(statusLeituraFiltros).some((v) => v === 'excluir');
    return incluidos.length === 1 && !temExcluido ? incluidos[0] : '';
  }, [statusLeituraFiltros]);

  function selecionarStatusLeituraDropdown(valor: string) {
    setStatusLeituraFiltros(valor ? { [valor]: 'incluir' } : {});
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

  const contagemNovel = useMemo(
    () => (obras ?? []).filter((o) => familiaDeTipo(o.tipo) === 'novel').length,
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
    const filtros: FiltrosSalvos = {
      busca,
      tipo,
      statusLeituraFiltros,
      statusPublicacao,
      generosSel,
      tagsSel,
      filtroNovoCapitulo,
      filtroNovel,
      filtroUnsourced,
    };
    return obrasFiltradasOrdenadas(obras, fontesPorObra, filtros, ordenacao);
  }, [
    obras,
    busca,
    tipo,
    statusLeituraFiltros,
    statusPublicacao,
    generosSel,
    tagsSel,
    filtroNovoCapitulo,
    filtroNovel,
    filtroUnsourced,
    fontesPorObra,
    ordenacao,
  ]);

  const temFiltroAtivo =
    !!busca ||
    !!tipo ||
    Object.values(statusLeituraFiltros).some((v) => v !== 'off') ||
    !!statusPublicacao ||
    generosSel.length > 0 ||
    tagsSel.length > 0 ||
    filtroNovoCapitulo !== 'off' ||
    filtroNovel !== 'off' ||
    filtroUnsourced !== 'off';

  function limparFiltros() {
    setBusca('');
    setTipo('');
    setStatusLeituraFiltros({});
    setStatusPublicacao('');
    setGenerosSel([]);
    setTagsSel([]);
    setFiltroNovoCapitulo('off');
    setFiltroNovel('off');
    setFiltroUnsourced('off');
  }

  const carregando = obras === undefined;
  const acervoVazio = !carregando && obras.length === 0;

  // Guarda a posição de scroll o tempo todo (não só ao sair) — cobre tanto o
  // "voltar" da obra quanto qualquer outra navegação pra fora da lista.
  useEffect(() => {
    function salvarScroll() {
      sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
    }
    window.addEventListener('scroll', salvarScroll, { passive: true });
    return () => window.removeEventListener('scroll', salvarScroll);
  }, []);

  // Restaura a posição salva só depois que a lista de verdade renderizou
  // (não no esqueleto de loading), senão a altura da página ainda não bate.
  const scrollRestaurado = useRef(false);
  useLayoutEffect(() => {
    if (scrollRestaurado.current || carregando) return;
    scrollRestaurado.current = true;
    const salvo = sessionStorage.getItem(SCROLL_KEY);
    if (salvo) {
      window.scrollTo(0, Number(salvo));
    }
  }, [carregando]);

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
          className={`status-chip status-chip-novo ${classeEstadoFiltro(filtroNovoCapitulo)}`}
          onClick={() => setFiltroNovoCapitulo(proximoEstadoFiltro)}
          title={tituloEstadoFiltro(filtroNovoCapitulo)}
        >
          New chapters
          <span className="status-chip-contagem">{contagemNovoCapitulo}</span>
        </button>
        <button
          type="button"
          className={`status-chip status-chip-novel ${classeEstadoFiltro(filtroNovel)}`}
          onClick={() => setFiltroNovel(proximoEstadoFiltro)}
          title={tituloEstadoFiltro(filtroNovel)}
        >
          Novel
          <span className="status-chip-contagem">{contagemNovel}</span>
        </button>
        {statusLeituraOpcoes.map((v) => (
          <button
            key={v}
            type="button"
            className={`status-chip ${classeEstadoFiltro(statusLeituraFiltros[v] ?? 'off')}`}
            onClick={() => alternarStatusChip(v)}
            title={tituloEstadoFiltro(statusLeituraFiltros[v] ?? 'off')}
          >
            {v}
            <span className="status-chip-contagem">{contagemStatus.get(v) ?? 0}</span>
          </button>
        ))}
        <button
          type="button"
          className={`status-chip status-chip-unsourced ${classeEstadoFiltro(filtroUnsourced)}`}
          onClick={() => setFiltroUnsourced(proximoEstadoFiltro)}
          title={tituloEstadoFiltro(filtroUnsourced)}
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
          <select value={statusLeituraDropdownValor} onChange={(e) => selecionarStatusLeituraDropdown(e.target.value)}>
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
            <ObraCard key={obra.id} obra={obra} fontes={fontesPorObra.get(obra.id) ?? []} sitesAtivos={sitesAtivos} />
          ))}
        </div>
      )}
    </div>
  );
}
