import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { db } from '../db/localDb';
import { ObraCard } from '../components/ObraCard';
import { TagPicker } from '../components/TagPicker';
import { BuscaObras } from '../components/BuscaObras';
import { useModoEdicao } from '../components/ModoEdicaoContext';
import {
  IconeColorido,
  IconeEmbaralhar,
  IconeEsconderFiltros,
  IconeFiltros,
  IconeLimparFiltros,
  IconeSairModoEdicao,
  IconeVoltarTopo,
} from '../components/Icones';
import { useListasPorCategoria } from '../hooks/useListas';
import { useSitesAtivos } from '../hooks/useSitesAtivos';
import { familiaDeTipo, temNovoCapitulo } from '../lib/obra';
import {
  ORDENACOES,
  lerFiltrosSalvos,
  lerOrdenacaoSalva,
  limparFiltrosSalvos,
  obrasFiltradasOrdenadas,
  proximoEstadoFiltro,
  salvarFiltros,
  semCapa,
  temFiltroAtivo as calcularTemFiltroAtivo,
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

/** Os cinco filtros de "lacuna" (dados faltando): visíveis direto nos chips de
 * status durante o Edit mode (uso frequente ao arrumar o acervo), e dentro do
 * painel "Filters" no modo normal (uso ocasional, não precisa de espaço fixo). */
interface ChipLacunaConfig {
  key: string;
  classe: string;
  label: string;
  contagem: number;
  estado: EstadoFiltro;
  setEstado: Dispatch<SetStateAction<EstadoFiltro>>;
}

function renderChipLacuna(chip: ChipLacunaConfig) {
  return (
    <button
      key={chip.key}
      type="button"
      className={`status-chip ${chip.classe} ${classeEstadoFiltro(chip.estado)}`}
      onClick={() => chip.setEstado(proximoEstadoFiltro)}
      title={tituloEstadoFiltro(chip.estado)}
    >
      {chip.label}
      <span className="status-chip-contagem">{chip.contagem}</span>
    </button>
  );
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
  const [filtroFavorito, setFiltroFavorito] = useState<EstadoFiltro>(() => lerFiltrosSalvos().filtroFavorito);
  const [filtroNovoCapitulo, setFiltroNovoCapitulo] = useState<EstadoFiltro>(
    () => lerFiltrosSalvos().filtroNovoCapitulo
  );
  const [filtroNovel, setFiltroNovel] = useState<EstadoFiltro>(() => lerFiltrosSalvos().filtroNovel);
  const [filtroUnsourced, setFiltroUnsourced] = useState<EstadoFiltro>(() => lerFiltrosSalvos().filtroUnsourced);
  const [filtroSemCapa, setFiltroSemCapa] = useState<EstadoFiltro>(() => lerFiltrosSalvos().filtroSemCapa);
  const [filtroSemNu, setFiltroSemNu] = useState<EstadoFiltro>(() => lerFiltrosSalvos().filtroSemNu);
  const [filtroSemNota, setFiltroSemNota] = useState<EstadoFiltro>(() => lerFiltrosSalvos().filtroSemNota);
  const [filtroSemTipo, setFiltroSemTipo] = useState<EstadoFiltro>(() => lerFiltrosSalvos().filtroSemTipo);
  const [filtroR15, setFiltroR15] = useState<EstadoFiltro>(() => lerFiltrosSalvos().filtroR15);
  const [filtroR18, setFiltroR18] = useState<EstadoFiltro>(() => lerFiltrosSalvos().filtroR18);
  const [scoresSel, setScoresSel] = useState<number[]>(() => lerFiltrosSalvos().scoresSel);
  const [incluirSemNota, setIncluirSemNota] = useState(() => lerFiltrosSalvos().incluirSemNota);
  const [ordenacao, setOrdenacao] = useState<Ordenacao>(lerOrdenacaoSalva);
  // Chaves de embaralhamento (Shuffle): geradas só ao clicar em "embaralhar",
  // não a cada render — senão a lista pularia sozinha a cada re-render/filtro
  // alterado enquanto o modo aleatório está ativo.
  const [chavesAleatorias, setChavesAleatorias] = useState<Map<string, number>>(new Map());
  const [viewMode, setViewMode] = useState<ViewMode>(lerViewModeSalvo);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [mostrarBotaoTopo, setMostrarBotaoTopo] = useState(false);

  // Edit mode (Handout 2): só existe na visualização List. Declarar a
  // disponibilidade aqui é o que habilita o botão do header; o cleanup desliga
  // o modo ao navegar pra outra aba.
  const { modoEdicao, setDisponivel, sairDoModo, obraFixada, headerBotaoVisivel } = useModoEdicao();

  useEffect(() => {
    setDisponivel(viewMode === 'list');
    return () => setDisponivel(false);
  }, [viewMode, setDisponivel]);

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
      filtroFavorito,
      filtroNovoCapitulo,
      filtroNovel,
      filtroUnsourced,
      filtroSemCapa,
      filtroSemNu,
      filtroSemNota,
      filtroSemTipo,
      filtroR15,
      filtroR18,
      scoresSel,
      incluirSemNota,
    };
    salvarFiltros(dados);
  }, [
    busca,
    tipo,
    statusLeituraFiltros,
    statusPublicacao,
    generosSel,
    tagsSel,
    filtroFavorito,
    filtroNovoCapitulo,
    filtroNovel,
    filtroUnsourced,
    filtroSemCapa,
    filtroSemNu,
    filtroSemNota,
    filtroSemTipo,
    filtroR15,
    filtroR18,
    scoresSel,
    incluirSemNota,
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

  function alternarScoreChip(valor: number) {
    setScoresSel((atual) => (atual.includes(valor) ? atual.filter((v) => v !== valor) : [...atual, valor]));
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

  const contagemSemCapa = useMemo(() => (obras ?? []).filter(semCapa).length, [obras]);
  const contagemSemNu = useMemo(
    () => (obras ?? []).filter((o) => !o.novelupdates_url).length,
    [obras]
  );
  const contagemSemNota = useMemo(() => (obras ?? []).filter((o) => o.score == null).length, [obras]);
  const contagemSemTipo = useMemo(() => (obras ?? []).filter((o) => !o.tipo).length, [obras]);
  const contagemR15 = useMemo(() => (obras ?? []).filter((o) => o.classificacao === 'R-15').length, [obras]);
  const contagemR18 = useMemo(() => (obras ?? []).filter((o) => o.classificacao === 'R-18').length, [obras]);

  const chipsLacuna: ChipLacunaConfig[] = [
    { key: 'unsourced', classe: 'status-chip-unsourced', label: 'Unsourced', contagem: contagemUnsourced, estado: filtroUnsourced, setEstado: setFiltroUnsourced },
    { key: 'sem-capa', classe: 'status-chip-sem-capa', label: 'No cover', contagem: contagemSemCapa, estado: filtroSemCapa, setEstado: setFiltroSemCapa },
    { key: 'sem-nu', classe: 'status-chip-sem-nu', label: 'No NU link', contagem: contagemSemNu, estado: filtroSemNu, setEstado: setFiltroSemNu },
    { key: 'sem-nota', classe: 'status-chip-sem-nota', label: 'No rating', contagem: contagemSemNota, estado: filtroSemNota, setEstado: setFiltroSemNota },
    { key: 'sem-tipo', classe: 'status-chip-sem-tipo', label: 'No type', contagem: contagemSemTipo, estado: filtroSemTipo, setEstado: setFiltroSemTipo },
  ];

  const filtradasBase = useMemo(() => {
    if (!obras) return [];
    const filtros: FiltrosSalvos = {
      busca,
      tipo,
      statusLeituraFiltros,
      statusPublicacao,
      generosSel,
      tagsSel,
      filtroFavorito,
      filtroNovoCapitulo,
      filtroNovel,
      filtroUnsourced,
      filtroSemCapa,
      filtroSemNu,
      filtroSemNota,
      filtroSemTipo,
      filtroR15,
      filtroR18,
      scoresSel,
      incluirSemNota,
    };
    // Base estável mesmo em modo aleatório ('aleatorio' não é um Ordenacao que
    // comparar() sabe ordenar de fato) — a reordenação aleatória acontece a
    // seguir, por cima do resultado já filtrado.
    return obrasFiltradasOrdenadas(
      obras,
      fontesPorObra,
      filtros,
      ordenacao === 'aleatorio' ? 'titulo' : ordenacao,
      obraFixada
    );
  }, [
    obras,
    busca,
    tipo,
    statusLeituraFiltros,
    statusPublicacao,
    generosSel,
    tagsSel,
    filtroFavorito,
    filtroNovoCapitulo,
    filtroNovel,
    filtroUnsourced,
    filtroSemCapa,
    filtroSemNu,
    filtroSemNota,
    filtroSemTipo,
    filtroR15,
    filtroR18,
    scoresSel,
    incluirSemNota,
    fontesPorObra,
    ordenacao,
    obraFixada,
  ]);

  // Embaralhar (Shuffle): só reordena quando ordenacao === 'aleatorio', usando
  // as chaves geradas no último clique em "embaralhar" (embaralhar() abaixo).
  // Obras sem chave ainda (passaram a bater os filtros depois do último clique)
  // vão pro final, em vez de reembaralhar tudo sozinho a cada mudança de filtro.
  const filtradas = useMemo(() => {
    if (ordenacao !== 'aleatorio') return filtradasBase;
    return [...filtradasBase].sort(
      (a, b) => (chavesAleatorias.get(a.id) ?? Infinity) - (chavesAleatorias.get(b.id) ?? Infinity)
    );
  }, [filtradasBase, ordenacao, chavesAleatorias]);

  function embaralhar() {
    setOrdenacao('aleatorio'); // não passa por alternarOrdenacao — não persiste no localStorage
    setChavesAleatorias((atual) => {
      const novo = new Map(atual);
      for (const o of filtradasBase) novo.set(o.id, Math.random());
      return novo;
    });
  }

  const temFiltroAtivo = calcularTemFiltroAtivo({
    busca,
    tipo,
    statusLeituraFiltros,
    statusPublicacao,
    generosSel,
    tagsSel,
    filtroFavorito,
    filtroNovoCapitulo,
    filtroNovel,
    filtroUnsourced,
    filtroSemCapa,
    filtroSemNu,
    filtroSemNota,
    filtroSemTipo,
    filtroR15,
    filtroR18,
    scoresSel,
    incluirSemNota,
  });

  function limparFiltros() {
    setBusca('');
    setTipo('');
    setStatusLeituraFiltros({});
    setStatusPublicacao('');
    setGenerosSel([]);
    setTagsSel([]);
    setFiltroFavorito('off');
    setFiltroNovoCapitulo('off');
    setFiltroNovel('off');
    setFiltroUnsourced('off');
    setFiltroSemCapa('off');
    setFiltroSemNu('off');
    setFiltroSemNota('off');
    setFiltroSemTipo('off');
    setFiltroR15('off');
    setFiltroR18('off');
    setScoresSel([]);
    setIncluirSemNota(false);
    limparFiltrosSalvos();
  }

  const carregando = obras === undefined;
  const acervoVazio = !carregando && obras.length === 0;

  // Guarda a posição de scroll o tempo todo (não só ao sair) — cobre tanto o
  // "voltar" da obra quanto qualquer outra navegação pra fora da lista.
  useEffect(() => {
    function salvarScroll() {
      sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
      setMostrarBotaoTopo(window.scrollY > 300);
    }
    window.addEventListener('scroll', salvarScroll, { passive: true });
    return () => window.removeEventListener('scroll', salvarScroll);
  }, []);

  function voltarAoTopo() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

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
      <BuscaObras value={busca} onChange={setBusca} />

      <div className="status-chips">
        <button
          type="button"
          className={`btn-icone favoritos-filtro-botao ${classeEstadoFiltro(filtroFavorito)}`}
          onClick={() => setFiltroFavorito(proximoEstadoFiltro)}
          title={`Favorites — ${tituloEstadoFiltro(filtroFavorito)}`}
          aria-label="Favorites filter"
        >
          <IconeColorido arquivo="w-color/stars-FECC01.svg" />
        </button>
        <button
          type="button"
          className={`btn-icone embaralhar-botao${ordenacao === 'aleatorio' ? ' ativo' : ''}`}
          onClick={embaralhar}
          title="Shuffle results"
          aria-label="Shuffle results"
        >
          <IconeEmbaralhar />
        </button>
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
          className={`status-chip status-chip-r15 ${classeEstadoFiltro(filtroR15)}`}
          onClick={() => setFiltroR15(proximoEstadoFiltro)}
          title={tituloEstadoFiltro(filtroR15)}
        >
          R-15
          <span className="status-chip-contagem">{contagemR15}</span>
        </button>
        <button
          type="button"
          className={`status-chip status-chip-r18 ${classeEstadoFiltro(filtroR18)}`}
          onClick={() => setFiltroR18(proximoEstadoFiltro)}
          title={tituloEstadoFiltro(filtroR18)}
        >
          R-18
          <span className="status-chip-contagem">{contagemR18}</span>
        </button>
        {/* Os cinco chips de lacuna ficam direto aqui só durante o Edit mode
            (uso frequente ao arrumar o acervo); no modo normal moram dentro
            do painel "Filters" — ver chipsLacuna mais abaixo. */}
        {modoEdicao && chipsLacuna.map(renderChipLacuna)}
      </div>

      <div className="filtros-toggle-row">
        <button
          type="button"
          className="btn-icone"
          onClick={() => setFiltrosAbertos((v) => !v)}
          aria-expanded={filtrosAbertos}
          aria-label={filtrosAbertos ? 'Hide filters' : 'Filters'}
          title={filtrosAbertos ? 'Hide filters' : 'Filters'}
        >
          {filtrosAbertos ? <IconeEsconderFiltros /> : <IconeFiltros />}
          {temFiltroAtivo && <span className="filtros-toggle-dot" />}
        </button>
        {temFiltroAtivo && (
          <button
            type="button"
            className="btn-icone"
            onClick={limparFiltros}
            aria-label="Clear filters"
            title="Clear filters"
          >
            <IconeLimparFiltros />
          </button>
        )}
      </div>

      {filtrosAbertos && (
        <div className="filtros filtros-aberto">
          {/* Fora do Edit mode os chips de lacuna ficam aqui — uso ocasional,
              não precisam de espaço fixo nos chips de status. */}
          {!modoEdicao && <div className="filtros-chips-lacuna">{chipsLacuna.map(renderChipLacuna)}</div>}
          <div className="filtros-score">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`status-chip filtros-score-estrela${scoresSel.includes(n) ? ' selecionada' : ''}`}
                onClick={() => alternarScoreChip(n)}
              >
                {n}★
              </button>
            ))}
            <button
              type="button"
              className={`status-chip${incluirSemNota ? ' ativo' : ''}`}
              onClick={() => setIncluirSemNota((v) => !v)}
            >
              Include unrated
            </button>
          </div>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Type (all)</option>
            {tipos.map((v) => (
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
                <button
                  type="button"
                  className="btn-icone"
                  onClick={limparFiltros}
                  aria-label="Clear filters"
                  title="Clear filters"
                >
                  <IconeLimparFiltros />
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <div className={`grid-obras ${viewMode === 'list' ? 'list-view' : ''}`}>
          {filtradas.map((obra) => (
            <ObraCard
              key={obra.id}
              obra={obra}
              fontes={fontesPorObra.get(obra.id) ?? []}
              sitesAtivos={sitesAtivos}
              modoEdicao={modoEdicao}
            />
          ))}
        </div>
      )}

      {/* Saída sempre à mão depois que o botão do header sai da tela por
          rolagem — enquanto ele está visível, o flutuante fica invisível
          (mantido montado, não escondido por unmount) pra não duplicar o
          rato na tela. Fica ABAIXO do backdrop dos modais (z-index 90 < 100):
          com um modal aberto não dá pra sair do modo no meio de uma edição
          sem fechar o modal antes. */}
      {modoEdicao && (
        <button
          type="button"
          className={`btn-icone rato-botao modo-edicao-flutuante${headerBotaoVisivel ? '' : ' visivel'}`}
          onClick={sairDoModo}
          title="Exit edit mode"
          aria-label="Exit edit mode"
          tabIndex={headerBotaoVisivel ? -1 : undefined}
          aria-hidden={headerBotaoVisivel}
        >
          <IconeSairModoEdicao />
        </button>
      )}

      {/* Volta ao topo: canto inferior direito, sempre montado com position:
          fixed — só a opacidade muda com o scroll (mesma técnica do
          flutuante do rato), sem entrar/sair do DOM pra não "pular". */}
      <button
        type="button"
        className={`btn-icone voltar-topo-flutuante${mostrarBotaoTopo ? ' visivel' : ''}`}
        onClick={voltarAoTopo}
        title="Back to top"
        aria-label="Back to top"
        tabIndex={mostrarBotaoTopo ? undefined : -1}
        aria-hidden={!mostrarBotaoTopo}
      >
        <IconeVoltarTopo />
      </button>
    </div>
  );
}
