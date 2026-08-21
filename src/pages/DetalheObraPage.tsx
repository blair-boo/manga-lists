import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { db } from '../db/localDb';
import {
  criarContraparteVinculada,
  deleteFonte,
  deleteObra,
  desvincularObra,
  setFonteAprovacao,
  setFonteTipo,
  updateFonte,
  updateObra,
  vincularObras,
  type NovaObra,
} from '../db/repo';
import { useListasPorCategoria } from '../hooks/useListas';
import { useSitesAtivos } from '../hooks/useSitesAtivos';
import { useLongPress } from '../hooks/useLongPress';
import { TagPicker } from '../components/TagPicker';
import { CapaUploader } from '../components/CapaUploader';
import { StatusScraper } from '../components/StatusScraper';
import { VinculoObraSelect } from '../components/VinculoObraSelect';
import { BuscaObras } from '../components/BuscaObras';
import { LinkExterno } from '../components/LinkExterno';
import { LinkFonte } from '../components/LinkFonte';
import { FavoritoBotao } from '../components/FavoritoBotao';
import { useToast } from '../components/Toast';
import { useDialogos } from '../components/Dialogo';
import { ModalBase } from '../components/ModalBase';
import { IconeDisquete, IconeGrip, IconeLimparFiltros, IconeMais, IconeTrocar, IconeX } from '../components/Icones';
import { familiaDeTipo } from '../lib/obra';
import {
  lerFiltrosSalvos,
  lerOrdenacaoSalva,
  limparFiltrosSalvos,
  obrasFiltradasOrdenadas,
  salvarBusca,
  temFiltroAtivo,
} from '../lib/filtrosLista';
import { dominioDeUrl } from '../lib/scraperConfig';
import { urlNormalizada } from '../lib/site';
import { salvarCamposObra } from '../lib/salvarObra';
import { adicionarFonteNaObra } from '../lib/adicionarFonte';
import type { Classificacao, FamiliaTipo, Fonte, Obra, StatusAprovacao } from '../types';

const TIPO_FONTE_OPCOES: { valor: FamiliaTipo; rotulo: string }[] = [
  { valor: 'manga', rotulo: 'Manga' },
  { valor: 'novel', rotulo: 'Novel' },
];

function statusBadgeClasse(status: StatusAprovacao): string {
  if (status === 'aprovado') return 'badge badge-aprovado';
  if (status === 'rejeitado') return 'badge badge-rejeitado';
  return 'badge badge-pendente';
}

function statusAprovacaoLabel(status: StatusAprovacao): string {
  if (status === 'aprovado') return 'approved';
  if (status === 'rejeitado') return 'rejected';
  return 'pending';
}

/** Ordena por `ordem` asc; fontes legadas (ordem null) por último, desempate por criado_em. */
function ordenarFontes(fontes: Fonte[]): Fonte[] {
  return [...fontes].sort((a, b) => {
    if (a.ordem == null && b.ordem == null) return a.criado_em.localeCompare(b.criado_em);
    if (a.ordem == null) return 1;
    if (b.ordem == null) return -1;
    if (a.ordem !== b.ordem) return a.ordem - b.ordem;
    return a.criado_em.localeCompare(b.criado_em);
  });
}

function FonteItem({
  fonte,
  sitesAtivos,
  onMudarTipo,
}: {
  fonte: Fonte;
  sitesAtivos: Set<string>;
  onMudarTipo: (fonte: Fonte, tipo: FamiliaTipo | null) => void;
}) {
  const [capitulo, setCapitulo] = useState(fonte.ultimo_capitulo_detectado?.toString() ?? '');
  const nomeSite = fonte.site || dominioDeUrl(fonte.url) || fonte.url;
  const naoMonitorada = !sitesAtivos.has(nomeSite.toLowerCase());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setCapitulo(fonte.ultimo_capitulo_detectado?.toString() ?? '');
    }
  }, [fonte.ultimo_capitulo_detectado]);

  async function handleBlur() {
    const valor = capitulo.trim() === '' ? null : Number(capitulo);
    const novoValor = valor !== null && Number.isNaN(valor) ? null : valor;
    if (novoValor !== fonte.ultimo_capitulo_detectado) {
      await updateFonte(fonte.id, { ultimo_capitulo_detectado: novoValor });
    }
  }

  return (
    <li className="fonte-item">
      <a href={fonte.url} target="_blank" rel="noreferrer">
        {nomeSite}
      </a>
      {naoMonitorada && (
        <span className="badge-nao-monitorada" title="Domain not approved for scraping">
          unmonitored
        </span>
      )}
      <span className={statusBadgeClasse(fonte.status_aprovacao)}>{statusAprovacaoLabel(fonte.status_aprovacao)}</span>
      <select
        className="fonte-tipo-select"
        value={fonte.tipo_detectado ?? ''}
        onChange={(e) => onMudarTipo(fonte, (e.target.value || null) as FamiliaTipo | null)}
        title="Source type (manga/novel)"
      >
        <option value="">Type?</option>
        {TIPO_FONTE_OPCOES.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
      {fonte.tipo_manual && (
        <span className="badge-tipo-manual" title="Type set manually — the scraper won't override it">
          manual
        </span>
      )}
      <label className="fonte-capitulo">
        ch.
        <input
          ref={inputRef}
          type="number"
          step="any"
          value={capitulo}
          onChange={(e) => setCapitulo(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') inputRef.current?.blur();
          }}
        />
      </label>
      <StatusScraper fonte={fonte} />
      <div className="fonte-acoes">
        {fonte.status_aprovacao !== 'aprovado' && (
          <button type="button" onClick={() => setFonteAprovacao(fonte.id, 'aprovado')}>
            Approve
          </button>
        )}
        {fonte.status_aprovacao !== 'rejeitado' && (
          <button type="button" onClick={() => setFonteAprovacao(fonte.id, 'rejeitado')}>
            Reject
          </button>
        )}
        <button type="button" onClick={() => deleteFonte(fonte.id)}>
          Delete
        </button>
      </div>
    </li>
  );
}

/** Fonte em modo de reordenação: só handle + nome do site (ações ocultas — F3). */
function FonteSortable({ fonte }: { fonte: Fonte }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: fonte.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const nomeSite = fonte.site || dominioDeUrl(fonte.url) || fonte.url;

  return (
    <li ref={setNodeRef} style={style} className={`fonte-item ${isDragging ? 'arrastando' : ''}`}>
      <span className="fonte-handle" {...attributes} {...listeners} aria-label="Drag to reorder">
        <IconeGrip />
      </span>
      <a href={fonte.url} target="_blank" rel="noreferrer">
        {nomeSite}
      </a>
    </li>
  );
}

/** Campos com autosave (Bloco E1) — observacoes fica FORA (tem Save/Cancel próprios em E2). */
type Draft = Pick<
  Obra,
  | 'titulo'
  | 'titulos_alternativos'
  | 'autor'
  | 'artistas'
  | 'capa_url'
  | 'tipo'
  | 'status_leitura'
  | 'status_publicacao'
  | 'fim_de_temporada'
  | 'capitulo_atual'
  | 'score'
  | 'classificacao'
  | 'pdf'
  | 'novelupdates_url'
  | 'anilist_url'
  | 'myanimelist_url'
  | 'mangaupdates_url'
  | 'mangadex_url'
  | 'mangabaka_url'
  | 'generos'
  | 'tags'
>;

function toDraft(obra: Obra): Draft {
  return {
    titulo: obra.titulo,
    titulos_alternativos: obra.titulos_alternativos,
    autor: obra.autor,
    artistas: obra.artistas,
    capa_url: obra.capa_url,
    tipo: obra.tipo,
    status_leitura: obra.status_leitura,
    status_publicacao: obra.status_publicacao,
    fim_de_temporada: obra.fim_de_temporada,
    capitulo_atual: obra.capitulo_atual,
    score: obra.score,
    classificacao: obra.classificacao,
    // ?? normaliza registros locais antigos (cacheados antes destas colunas
    // existirem): sem isso, draft.pdf viria undefined e o checkbox ficaria
    // não-controlado até a obra ser re-sincronizada.
    pdf: obra.pdf ?? false,
    novelupdates_url: obra.novelupdates_url ?? null,
    anilist_url: obra.anilist_url ?? null,
    myanimelist_url: obra.myanimelist_url ?? null,
    mangaupdates_url: obra.mangaupdates_url ?? null,
    mangadex_url: obra.mangadex_url ?? null,
    mangabaka_url: obra.mangabaka_url ?? null,
    generos: obra.generos,
    tags: obra.tags,
  };
}

function camposAlterados(draft: Draft, snap: Draft): Partial<NovaObra> {
  const changes: Partial<NovaObra> = {};
  (Object.keys(draft) as (keyof Draft)[]).forEach((k) => {
    if (draft[k] !== snap[k]) (changes as Record<string, unknown>)[k] = draft[k];
  });
  return changes;
}

const AUTOSAVE_MS = 600;

export function DetalheObraPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { mostrarToast } = useToast();
  const { confirmar } = useDialogos();
  const obra = useLiveQuery(() => (id ? db.obras.get(id) : undefined), [id]);
  const fontes = useLiveQuery(() => (id ? db.fontes.where('obra_id').equals(id).toArray() : []), [id]);
  const obraVinculada = useLiveQuery(
    () => (obra?.obra_vinculada_id ? db.obras.get(obra.obra_vinculada_id) : undefined),
    [obra?.obra_vinculada_id]
  );
  const sitesAtivos = useSitesAtivos();
  // Long-press pra desvincular (mesmo padrão dos ícones de fonte/catálogo).
  // handleDesvincular é function declaration (hoisted) — pode ser referenciada
  // aqui mesmo sendo definida mais abaixo no corpo do componente.
  const pressVinculo = useLongPress({
    onClick: () => {
      if (obraVinculada) navigate(`/obra/${obraVinculada.id}`);
    },
    onLongPress: () => {
      if (obraVinculada) void handleDesvincular();
    },
  });

  // Pro botão Next: mesma lista filtrada/ordenada da tela List (filtros e
  // ordenação persistidos em localStorage), pra achar a próxima obra.
  const todasObras = useLiveQuery(() => db.obras.toArray(), []);
  const todasFontes = useLiveQuery(() => db.fontes.toArray(), []);
  const proximaObra = useMemo(() => {
    if (!todasObras || !todasFontes || !id) return null;
    const fontesPorObra = new Map<string, Fonte[]>();
    for (const f of todasFontes) {
      const lista = fontesPorObra.get(f.obra_id) ?? [];
      lista.push(f);
      fontesPorObra.set(f.obra_id, lista);
    }
    const ordenadas = obrasFiltradasOrdenadas(todasObras, fontesPorObra, lerFiltrosSalvos(), lerOrdenacaoSalva());
    const indice = ordenadas.findIndex((o) => o.id === id);
    if (indice === -1 || indice === ordenadas.length - 1) return null;
    return ordenadas[indice + 1];
  }, [todasObras, todasFontes, id]);

  const tipos = useListasPorCategoria('tipo');
  const statusLeituraOpcoes = useListasPorCategoria('status_leitura');
  const statusPublicacaoOpcoes = useListasPorCategoria('status_publicacao');
  const generos = useListasPorCategoria('genero');
  const tags = useListasPorCategoria('tag');

  // Campo de busca compartilhado com a lista (Bloco C3): estado próprio aqui
  // (não há lista pra filtrar), sincronizado com o mesmo localStorage.
  const [busca, setBusca] = useState(() => lerFiltrosSalvos().busca);

  function alterarBusca(texto: string) {
    setBusca(texto);
    salvarBusca(texto);
  }

  // A busca é o único filtro que esta tela altera, então recalcular a partir
  // do localStorage (em vez de manter os demais filtros em estado) já reflete
  // qualquer alteração feita na lista antes de navegar pra cá.
  const filtroAtivo = useMemo(() => temFiltroAtivo({ ...lerFiltrosSalvos(), busca }), [busca]);

  function handleLimparFiltros() {
    limparFiltrosSalvos();
    setBusca('');
  }

  const [obraIdCarregado, setObraIdCarregado] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const snapshotRef = useRef<Draft | null>(null); // último estado persistido (autosave)

  // Notes (observacoes): estado próprio com Save/Cancel (Bloco E2), fora do autosave.
  const [observacoesDraft, setObservacoesDraft] = useState<string | null>(null);
  const [observacoesSalvas, setObservacoesSalvas] = useState<string | null>(null);

  const [novaFonteUrl, setNovaFonteUrl] = useState('');
  const [mostrarCaixaVinculo, setMostrarCaixaVinculo] = useState(false);
  const [vinculoEscolhidoId, setVinculoEscolhidoId] = useState('');

  // Reordenação de fontes (Bloco F3)
  const [editandoOrdem, setEditandoOrdem] = useState(false);
  const [ordemLocal, setOrdemLocal] = useState<Fonte[]>([]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Carga inicial do draft quando a obra chega/muda. Grava o snapshot no mesmo
  // momento pra o autosave não disparar só por ter carregado do banco.
  useEffect(() => {
    if (obra && obra.id !== obraIdCarregado) {
      const d = toDraft(obra);
      setDraft(d);
      snapshotRef.current = d;
      setObraIdCarregado(obra.id);
      setObservacoesDraft(obra.observacoes);
      setObservacoesSalvas(obra.observacoes);
    }
  }, [obra, obraIdCarregado]);

  // Autosave com debounce: persiste os campos do draft que diferem do snapshot,
  // exceto observacoes (que nem está no draft). Atualiza o snapshot ANTES do
  // await pra evitar re-gravação quando a obra reativa re-dispara este efeito.
  useEffect(() => {
    if (!id || draft === null || obra === undefined || snapshotRef.current === null) return;
    if (Object.keys(camposAlterados(draft, snapshotRef.current)).length === 0) return;
    const timer = window.setTimeout(() => {
      const snap = snapshotRef.current;
      if (snap === null) return;
      const changes = camposAlterados(draft, snap);
      if (Object.keys(changes).length === 0) return;
      // Edição manual do status de publicação: trava contra sobrescrita do
      // scraper (status do comix), mesmo critério de tipo_manual em fontes (B4).
      if ('status_publicacao' in changes) changes.status_publicacao_manual = true;
      snapshotRef.current = draft;
      void salvarCamposObra(
        { id, titulo: snap.titulo, tipo: snap.tipo, capa_url: snap.capa_url },
        changes,
        (mensagem) => mostrarToast(`Could not rename cover: ${mensagem}`, 'erro')
      );
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [draft, id, obra, mostrarToast]);

  const observacoesDirty = observacoesDraft !== observacoesSalvas;

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => observacoesDirty && currentLocation.pathname !== nextLocation.pathname
  );

  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (observacoesDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [observacoesDirty]);

  if (!id) return null;
  if (obra === undefined || draft === null) return <p>Loading…</p>;

  function setCampo<K extends keyof Draft>(campo: K, valor: Draft[K]) {
    setDraft((atual) => (atual ? { ...atual, [campo]: valor } : atual));
  }

  async function handleSalvarObservacoes() {
    if (!id) return;
    await updateObra(id, { observacoes: observacoesDraft || null });
    setObservacoesSalvas(observacoesDraft);
    mostrarToast('Notes saved ✓');
  }

  function handleCancelarObservacoes() {
    setObservacoesDraft(observacoesSalvas);
  }

  async function handleAdicionarFonte(e: FormEvent) {
    e.preventDefault();
    const limpo = novaFonteUrl.trim();
    if (!limpo || !id) return;
    // Sem essa checagem, um clique duplo (ou reenviar por achar que a primeira
    // vez "sumiu" — ver bug de sync corrigido em pullFontes) cria a mesma fonte
    // várias vezes, já que o formulário não recusava URL repetida como o modal
    // de Sources do Edit mode (ModalSources) já fazia.
    if ((fontes ?? []).some((f) => urlNormalizada(f.url) === urlNormalizada(limpo))) {
      mostrarToast('This work already has that source', 'info');
      return;
    }
    await adicionarFonteNaObra(id, limpo, draft?.tipo ?? null, fontes ?? []);
    setNovaFonteUrl('');
  }

  async function handleVincular() {
    if (!id || !vinculoEscolhidoId) return;
    await vincularObras(id, vinculoEscolhidoId);
    setVinculoEscolhidoId('');
    setMostrarCaixaVinculo(false);
    mostrarToast('Works linked ✓');
  }

  async function handleDesvincular() {
    if (!id) return;
    const ok = await confirmar({
      titulo: 'Unlink works',
      mensagem: `Unlink from "${obraVinculada?.titulo}"? Title, alternative title, genres and tags stop syncing between the two.`,
      confirmarRotulo: 'Unlink',
    });
    if (!ok) return;
    await desvincularObra(id);
    mostrarToast('Works unlinked');
  }

  // Cria a contraparte direto, sem pedir título — o título nasce espelhado da
  // obra de origem (C2), e daí em diante o espelhamento contínuo mantém os dois.
  async function handleCriarVinculada(tipoNovo: FamiliaTipo) {
    if (!obra) return;
    const nova = await criarContraparteVinculada(obra, tipoNovo);
    setMostrarCaixaVinculo(false);
    mostrarToast(`"${nova.titulo}" created and linked ✓`);
    return nova;
  }

  /**
   * Troca manual de tipo de uma fonte. Quando o novo tipo diverge da família
   * da obra atual, a fonte não move sozinha — ela passa a aparecer na fila
   * "Mismatched source types" (Updates), onde dá pra mover/criar/descartar ou
   * manter pra decidir depois.
   */
  async function handleMudarTipoFonte(fonte: Fonte, novoTipo: FamiliaTipo | null) {
    await setFonteTipo(fonte.id, novoTipo);
  }

  async function handleExcluirObra() {
    if (!id) return;
    const ok = await confirmar({
      titulo: 'Delete work',
      mensagem: `Delete "${obra?.titulo}" and all its sources?`,
      confirmarRotulo: 'Delete',
      perigoso: true,
    });
    if (!ok) return;
    await deleteObra(id);
    navigate('/');
  }

  // --- Reordenação de fontes (F3) ---
  const fontesOrdenadas = ordenarFontes(fontes ?? []);
  const ordemAlterou =
    editandoOrdem && ordemLocal.some((f, i) => f.id !== fontesOrdenadas[i]?.id);

  function entrarEdicaoOrdem() {
    setOrdemLocal(fontesOrdenadas);
    setEditandoOrdem(true);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setOrdemLocal((items) => {
        const de = items.findIndex((f) => f.id === active.id);
        const para = items.findIndex((f) => f.id === over.id);
        return arrayMove(items, de, para);
      });
    }
  }

  async function salvarOrdem() {
    // Só grava as fontes cujo índice difere da ordem já persistida.
    for (let i = 0; i < ordemLocal.length; i++) {
      if (ordemLocal[i].ordem !== i) await updateFonte(ordemLocal[i].id, { ordem: i });
    }
    setEditandoOrdem(false);
    mostrarToast('Source order saved ✓');
  }

  function cancelarOrdem() {
    setEditandoOrdem(false);
    setOrdemLocal([]);
  }

  return (
    <div className="detalhe-obra">
      <BuscaObras
        value={busca}
        onChange={alterarBusca}
        acaoDireita={
          filtroAtivo ? (
            <button
              type="button"
              className="btn-icone"
              onClick={handleLimparFiltros}
              aria-label="Clear filters"
              title="Clear filters"
            >
              <IconeLimparFiltros />
            </button>
          ) : null
        }
      />

      <div className="detalhe-obra-nav">
        <button type="button" className="voltar" onClick={() => navigate(-1)}>
          ← Back
        </button>
        {proximaObra && (
          <button
            type="button"
            className="voltar"
            onClick={() => navigate(`/obra/${proximaObra.id}`, { replace: true })}
          >
            Next →
          </button>
        )}
      </div>

      <div className="detalhe-obra-form">
        <div className="detalhe-obra-titulo-linha">
          <label>
            Title
            <input type="text" value={draft.titulo} onChange={(e) => setCampo('titulo', e.target.value)} />
          </label>
          <FavoritoBotao obra={obra} />
        </div>

        <TagPicker
          label="Associated Names"
          value={draft.titulos_alternativos ?? []}
          options={[]}
          onChange={(v) => setCampo('titulos_alternativos', v.length > 0 ? v : null)}
        />

        {/* Bloco topo (C): capa clicável à esquerda; Type, Corresponding work e
            Novel Updates empilhados e independentes à direita. */}
        <div className="obra-topo">
          <div className="obra-topo-capa">
            <CapaUploader
              capaUrl={draft.capa_url}
              titulo={draft.titulo}
              tipo={draft.tipo}
              onUploaded={(url) => setCampo('capa_url', url)}
            />
          </div>

          <div className="obra-topo-campos">
            <label>
              Type
              <select value={draft.tipo ?? ''} onChange={(e) => setCampo('tipo', (e.target.value || null) as Draft['tipo'])}>
                <option value="">—</option>
                {tipos.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>

            {/* Corresponding work — mesmo padrão visual do Novel Updates:
                rótulo + "+" que abre a caixa de busca/criação (Handout 3, C1). */}
            <div className="vinculo-obra-campo">
              <div className="vinculo-obra-topo-linha">
                <span className="vinculo-obra-label">Corresponding work:</span>
                <div className="vinculo-obra-acoes-topo">
                  {obraVinculada ? (
                    // Ícone no lugar do título (title/aria-label dizem qual é a obra).
                    // Clique curto abre a obra; pressionar e segurar desvincula
                    // (mesmo padrão dos ícones de fonte/catálogo).
                    <button
                      type="button"
                      className="btn-icone"
                      aria-label={`Open corresponding work "${obraVinculada.titulo}"`}
                      title={obraVinculada.titulo}
                      {...pressVinculo}
                    >
                      <IconeTrocar />
                    </button>
                  ) : (
                    !mostrarCaixaVinculo && (
                      <button
                        type="button"
                        className="btn-icone"
                        onClick={() => setMostrarCaixaVinculo(true)}
                        aria-label="Add corresponding work"
                        title="Add corresponding work"
                      >
                        <IconeMais />
                      </button>
                    )
                  )}
                </div>
              </div>

              {!obraVinculada && mostrarCaixaVinculo && (
                <div className="vinculo-obra-caixa">
                  <div className="vinculo-obra-caixa-linha">
                    <VinculoObraSelect excluirId={id} value={vinculoEscolhidoId} onChange={setVinculoEscolhidoId} />
                    <button type="button" onClick={handleVincular} disabled={!vinculoEscolhidoId}>
                      Link
                    </button>
                  </div>
                  <div className="vinculo-obra-caixa-acoes">
                    <button
                      type="button"
                      onClick={() => handleCriarVinculada(familiaDeTipo(draft.tipo) === 'novel' ? 'manga' : 'novel')}
                    >
                      Create
                    </button>
                    <button type="button" className="botao-secundario" onClick={() => setMostrarCaixaVinculo(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Links externos — Bloco E7: NU + os 5 links de catálogo do comix,
                todos no mesmo componente (LinkExterno), numa linha compartilhada. */}
            <div className="links-externos-linha">
              <LinkExterno
                nomeServico="Novel Updates"
                icone="w-color/novel-updates-435984.svg"
                url={draft.novelupdates_url}
                hostEsperado={/novelupdates\.com/i}
                onChange={(v) => setCampo('novelupdates_url', v)}
              />
              <LinkExterno
                nomeServico="AniList"
                icone="w-color/anilist-4F85E4.svg"
                url={draft.anilist_url}
                hostEsperado={/anilist\.co/i}
                onChange={(v) => setCampo('anilist_url', v)}
              />
              <LinkExterno
                nomeServico="MyAnimeList"
                icone="w-color/mal-27448A.svg"
                url={draft.myanimelist_url}
                hostEsperado={/myanimelist\.net/i}
                onChange={(v) => setCampo('myanimelist_url', v)}
              />
              <LinkExterno
                nomeServico="MangaUpdates"
                icone="w-color/manga-updates-original.svg"
                url={draft.mangaupdates_url}
                hostEsperado={/mangaupdates\.com/i}
                onChange={(v) => setCampo('mangaupdates_url', v)}
              />
              <LinkExterno
                nomeServico="MangaDex"
                icone="w-color/mangadex-original-icon.svg"
                url={draft.mangadex_url}
                hostEsperado={/mangadex\.org/i}
                onChange={(v) => setCampo('mangadex_url', v)}
              />
              <LinkExterno
                nomeServico="MangaBaka"
                icone="w-color/mangabaka-original.png"
                url={draft.mangabaka_url}
                hostEsperado={/mangabaka\.org/i}
                onChange={(v) => setCampo('mangabaka_url', v)}
              />
              <LinkFonte
                nomeServico="Comix.to"
                icone="w-color/comix-98CCF0.svg"
                hostEsperado={/comix\.to/i}
                obraId={id}
                tipoObra={draft.tipo}
                fontes={fontes ?? []}
              />
              <LinkFonte
                nomeServico="Lezhin"
                icone="w-color/lehzin-a40909.svg"
                hostEsperado={/lezhin/i}
                obraId={id}
                tipoObra={draft.tipo}
                fontes={fontes ?? []}
              />
              <LinkFonte
                nomeServico="Webtoon"
                icone="w-color/webtoon-5dac8e.svg"
                hostEsperado={/webtoons?\.com/i}
                obraId={id}
                tipoObra={draft.tipo}
                fontes={fontes ?? []}
              />
              <LinkFonte
                nomeServico="Tapas"
                icone="w-color/Tapas-logo-original.png"
                hostEsperado={/tapas\.io/i}
                obraId={id}
                tipoObra={draft.tipo}
                fontes={fontes ?? []}
              />
              <LinkFonte
                nomeServico="Manta"
                icone="w-color/manta-765AAF.svg"
                hostEsperado={/manta\.net/i}
                obraId={id}
                tipoObra={draft.tipo}
                fontes={fontes ?? []}
              />
              <LinkFonte
                nomeServico="TappyToon"
                icone="w-color/tapy-98f0ae.svg"
                hostEsperado={/tappytoon\.com/i}
                obraId={id}
                tipoObra={draft.tipo}
                fontes={fontes ?? []}
              />
            </div>
          </div>
        </div>

        <div className="detalhe-obra-grid">
          <label>
            Reading status
            <select
              value={draft.status_leitura ?? ''}
              onChange={(e) => setCampo('status_leitura', (e.target.value || null) as Draft['status_leitura'])}
            >
              <option value="">—</option>
              {statusLeituraOpcoes.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>

          <label>
            Current chapter
            <input
              type="number"
              step="any"
              value={draft.capitulo_atual ?? ''}
              onChange={(e) => setCampo('capitulo_atual', e.target.value === '' ? null : Number(e.target.value))}
            />
          </label>

          <label>
            Publication status
            <select
              value={draft.status_publicacao ?? ''}
              onChange={(e) => {
                const v = (e.target.value || null) as Draft['status_publicacao'];
                setDraft((atual) =>
                  atual
                    ? { ...atual, status_publicacao: v, fim_de_temporada: v === 'Hiatus' ? atual.fim_de_temporada : false }
                    : atual
                );
              }}
            >
              <option value="">—</option>
              {statusPublicacaoOpcoes.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>

          {draft.status_publicacao === 'Hiatus' && (
            <label className="check-inline">
              <input
                type="checkbox"
                checked={draft.fim_de_temporada}
                onChange={(e) => setCampo('fim_de_temporada', e.target.checked)}
              />
              End of Season
            </label>
          )}

          {/* Classificação R-15/R-18 (Bloco D1): campo único, marcar uma desmarca a outra. */}
          <div className="classificacao-campo">
            <span className="classificacao-label">Content rating</span>
            <div className="classificacao-caixas">
              {(['R-15', 'R-18'] as Classificacao[]).map((c) => (
                <label key={c} className="check-inline">
                  <input
                    type="checkbox"
                    checked={draft.classificacao === c}
                    onChange={(e) => setCampo('classificacao', e.target.checked ? c : null)}
                  />
                  {c}
                </label>
              ))}
            </div>
          </div>

          <label>
            Rating
            <select
              value={draft.score ?? ''}
              onChange={(e) => setCampo('score', e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">—</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {'★'.repeat(n)}
                </option>
              ))}
            </select>
          </label>

          {/* PDF (Bloco F): checkbox independente por obra (não espelhado), ao lado do Rating. */}
          <div className="pdf-campo">
            <span className="pdf-label">PDF</span>
            <label className="check-inline">
              <input type="checkbox" checked={draft.pdf} onChange={(e) => setCampo('pdf', e.target.checked)} />
              Yes
            </label>
          </div>
        </div>

        <TagPicker
          label="Genres"
          value={draft.generos ?? []}
          options={generos}
          onChange={(v) => setCampo('generos', v.length > 0 ? v : null)}
        />

        <TagPicker
          label="Tags"
          value={draft.tags ?? []}
          options={tags}
          onChange={(v) => setCampo('tags', v.length > 0 ? v : null)}
        />

        {/* Author + Artists (Handout comix, Bloco B1): rótulo em tamanho normal,
            valor em 12px — são campos de consulta, não de leitura frequente. */}
        <div className="autoria-linha">
          <label>
            Author
            <input
              type="text"
              className="campo-autoria"
              value={draft.autor ?? ''}
              onChange={(e) => setCampo('autor', e.target.value || null)}
            />
          </label>
          <label>
            Artists
            <input
              type="text"
              className="campo-autoria"
              value={draft.artistas ?? ''}
              onChange={(e) => setCampo('artistas', e.target.value || null)}
            />
          </label>
        </div>

        <label>
          Notes
          <textarea
            value={observacoesDraft ?? ''}
            onChange={(e) => setObservacoesDraft(e.target.value || null)}
            rows={4}
          />
        </label>
        {observacoesDirty && (
          <div className="observacoes-acoes">
            <button
              type="button"
              className="btn-icone"
              onClick={handleSalvarObservacoes}
              aria-label="Save notes"
              title="Save notes"
            >
              <IconeDisquete />
            </button>
            <button
              type="button"
              className="btn-icone btn-icone-perigo"
              onClick={handleCancelarObservacoes}
              aria-label="Discard notes"
              title="Discard notes"
            >
              <IconeX />
            </button>
          </div>
        )}
      </div>

      <section className="fontes-section">
        <div className="fontes-cabecalho">
          <h2>Sources</h2>
          {fontesOrdenadas.length > 1 &&
            (editandoOrdem ? (
              <>
                {ordemAlterou && (
                  <button type="button" className="btn-icone" onClick={salvarOrdem} aria-label="Save order" title="Save order">
                    <IconeDisquete />
                  </button>
                )}
                <button
                  type="button"
                  className="btn-icone btn-icone-perigo"
                  onClick={cancelarOrdem}
                  aria-label="Cancel reordering"
                  title="Cancel reordering"
                >
                  <IconeX />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn-icone"
                onClick={entrarEdicaoOrdem}
                aria-label="Reorder sources"
                title="Reorder sources"
              >
                <IconeGrip />
              </button>
            ))}
        </div>

        {editandoOrdem ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={ordemLocal.map((f) => f.id)} strategy={verticalListSortingStrategy}>
              <ul className="fontes-lista">
                {ordemLocal.map((f) => (
                  <FonteSortable key={f.id} fonte={f} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        ) : (
          <>
            <ul className="fontes-lista">
              {fontesOrdenadas.map((f) => (
                <FonteItem key={f.id} fonte={f} sitesAtivos={sitesAtivos} onMudarTipo={handleMudarTipoFonte} />
              ))}
              {fontesOrdenadas.length === 0 && <li className="fontes-vazio">No sources yet.</li>}
            </ul>

            <form className="nova-fonte-form" onSubmit={handleAdicionarFonte}>
              <input
                type="url"
                placeholder="Source URL"
                value={novaFonteUrl}
                onChange={(e) => setNovaFonteUrl(e.target.value)}
                required
              />
              <button type="submit">Add</button>
            </form>
          </>
        )}
      </section>

      {/* Delete work movido pro fim absoluto da página (Bloco C), separado das Sources. */}
      <div className="detalhe-obra-rodape">
        <button type="button" className="excluir-obra" onClick={handleExcluirObra}>
          Delete work
        </button>
      </div>

      {blocker.state === 'blocked' && (
        // O X deste modal equivale a "Keep editing": nunca descarta a nota. Se
        // um modal futuro tiver um caminho destrutivo, o X é sempre o caminho
        // seguro (cancelar), nunca o destrutivo.
        <ModalBase aberto rotulo="Unsaved notes" onFechar={() => blocker.reset()}>
          <p>You have unsaved notes on this work.</p>
          <div className="modal-acoes">
            <button
              type="button"
              onClick={async () => {
                await handleSalvarObservacoes();
                blocker.proceed();
              }}
            >
              Save and leave
            </button>
            <button
              type="button"
              onClick={() => {
                handleCancelarObservacoes();
                blocker.proceed();
              }}
            >
              Discard and leave
            </button>
            <button type="button" onClick={() => blocker.reset()}>
              Keep editing
            </button>
          </div>
        </ModalBase>
      )}
    </div>
  );
}
