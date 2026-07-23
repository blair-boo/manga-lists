import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
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
  createFonte,
  criarObraVinculada,
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
import { TagPicker } from '../components/TagPicker';
import { CapaUploader } from '../components/CapaUploader';
import { StatusScraper } from '../components/StatusScraper';
import { VinculoObraSelect } from '../components/VinculoObraSelect';
import { useToast } from '../components/Toast';
import { useDialogos } from '../components/Dialogo';
import { IconeDisquete, IconeGrip, IconeLivro, IconeMais, IconeX } from '../components/Icones';
import { deriveSite } from '../lib/site';
import { familiaDeTipo } from '../lib/obra';
import { dominioDeUrl, registrarDominioManual } from '../lib/scraperConfig';
import { renomearCapaSeNecessario } from '../lib/capaStorage';
import { mensagemDeErro } from '../lib/erros';
import type { Classificacao, FamiliaTipo, Fonte, Obra, StatusAprovacao, Tipo } from '../types';

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
  | 'capa_url'
  | 'tipo'
  | 'status_leitura'
  | 'status_publicacao'
  | 'fim_de_temporada'
  | 'capitulo_atual'
  | 'nota'
  | 'classificacao'
  | 'pdf'
  | 'novelupdates_url'
  | 'generos'
  | 'tags'
>;

function toDraft(obra: Obra): Draft {
  return {
    titulo: obra.titulo,
    titulos_alternativos: obra.titulos_alternativos,
    autor: obra.autor,
    capa_url: obra.capa_url,
    tipo: obra.tipo,
    status_leitura: obra.status_leitura,
    status_publicacao: obra.status_publicacao,
    fim_de_temporada: obra.fim_de_temporada,
    capitulo_atual: obra.capitulo_atual,
    nota: obra.nota,
    classificacao: obra.classificacao,
    // ?? normaliza registros locais antigos (cacheados antes destas colunas
    // existirem): sem isso, draft.pdf viria undefined e o checkbox ficaria
    // não-controlado até a obra ser re-sincronizada.
    pdf: obra.pdf ?? false,
    novelupdates_url: obra.novelupdates_url ?? null,
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
  const { confirmar, pedirTexto } = useDialogos();
  const obra = useLiveQuery(() => (id ? db.obras.get(id) : undefined), [id]);
  const fontes = useLiveQuery(() => (id ? db.fontes.where('obra_id').equals(id).toArray() : []), [id]);
  const obraVinculada = useLiveQuery(
    () => (obra?.obra_vinculada_id ? db.obras.get(obra.obra_vinculada_id) : undefined),
    [obra?.obra_vinculada_id]
  );
  const sitesAtivos = useSitesAtivos();

  const tipos = useListasPorCategoria('tipo');
  const statusLeituraOpcoes = useListasPorCategoria('status_leitura');
  const statusPublicacaoOpcoes = useListasPorCategoria('status_publicacao');
  const generos = useListasPorCategoria('genero');
  const tags = useListasPorCategoria('tag');

  const [obraIdCarregado, setObraIdCarregado] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const snapshotRef = useRef<Draft | null>(null); // último estado persistido (autosave)

  // Notas: estado próprio com Save/Cancel (Bloco E2), fora do autosave.
  const [notaDraft, setNotaDraft] = useState<string | null>(null);
  const [notaSalva, setNotaSalva] = useState<string | null>(null);

  const [novaFonteUrl, setNovaFonteUrl] = useState('');
  const [mostrarVinculo, setMostrarVinculo] = useState(false);
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
      setNotaDraft(obra.observacoes);
      setNotaSalva(obra.observacoes);
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
      snapshotRef.current = draft;
      void (async () => {
        if (('titulo' in changes || 'tipo' in changes) && snap.capa_url) {
          try {
            const novaCapaUrl = await renomearCapaSeNecessario(
              snap.capa_url,
              snap.titulo,
              snap.tipo,
              draft.titulo,
              draft.tipo
            );
            if (novaCapaUrl) changes.capa_url = novaCapaUrl;
          } catch (err) {
            mostrarToast(`Could not rename cover: ${mensagemDeErro(err)}`, 'erro');
            // segue o autosave dos outros campos mesmo se o rename da capa falhar
          }
        }
        await updateObra(id, changes);
      })();
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [draft, id, obra, mostrarToast]);

  const notasDirty = notaDraft !== notaSalva;

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => notasDirty && currentLocation.pathname !== nextLocation.pathname
  );

  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (notasDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [notasDirty]);

  if (!id) return null;
  if (obra === undefined || draft === null) return <p>Loading…</p>;

  function setCampo<K extends keyof Draft>(campo: K, valor: Draft[K]) {
    setDraft((atual) => (atual ? { ...atual, [campo]: valor } : atual));
  }

  async function handleSalvarNota() {
    if (!id) return;
    await updateObra(id, { observacoes: notaDraft || null });
    setNotaSalva(notaDraft);
    mostrarToast('Notes saved ✓');
  }

  function handleCancelarNota() {
    setNotaDraft(notaSalva);
  }

  async function handleAdicionarFonte(e: FormEvent) {
    e.preventDefault();
    if (!novaFonteUrl.trim() || !id) return;
    const url = novaFonteUrl.trim();
    // Nova fonte entra no fim da lista: maior ordem atual + 1 (Bloco F).
    const maiorOrdem = (fontes ?? []).reduce((max, f) => (f.ordem != null && f.ordem > max ? f.ordem : max), -1);
    await createFonte({
      obra_id: id,
      site: deriveSite(url),
      url,
      ultimo_capitulo_detectado: null,
      atualizado_por_scraper: false,
      confiavel: true,
      status_aprovacao: 'aprovado',
      descoberta_automaticamente: false,
      ultima_verificacao: null,
      tipo_detectado: null,
      tipo_manual: false,
      ordem: maiorOrdem + 1,
    });
    void registrarDominioManual(url); // domínio novo inserido à mão vira site suportado
    setNovaFonteUrl('');
  }

  async function handleVincular() {
    if (!id || !vinculoEscolhidoId) return;
    await vincularObras(id, vinculoEscolhidoId);
    setVinculoEscolhidoId('');
    setMostrarVinculo(false);
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

  // Novel Updates (Bloco E7): a gravação passa por setCampo -> autosave -> updateObra,
  // então o espelhamento na contraparte vinculada (E6, via CAMPOS_ESPELHADOS) é automático.
  async function handleRemoverNU() {
    const ok = await confirmar({
      titulo: 'Remove Novel Updates link',
      mensagem: 'Remove the Novel Updates link from this work?',
      confirmarRotulo: 'Remove',
    });
    if (!ok) return;
    setCampo('novelupdates_url', null);
  }

  async function handleAdicionarNU() {
    const url = await pedirTexto({
      titulo: 'Novel Updates link',
      mensagem: 'Paste the novelupdates.com URL for this work:',
      confirmarRotulo: 'Add',
    });
    if (url === null) return;
    const limpo = url.trim();
    if (!limpo) return;
    if (!/novelupdates\.com/i.test(limpo)) {
      mostrarToast("That doesn't look like a novelupdates.com URL", 'info');
      return;
    }
    setCampo('novelupdates_url', limpo);
  }

  async function handleCriarVinculada(tipoNovo: FamiliaTipo) {
    if (!id || !obra) return;
    const tituloNovo = await pedirTexto({
      titulo: 'Corresponding work',
      mensagem: 'Title for the corresponding work:',
      valorInicial: obra.titulo,
      confirmarRotulo: 'Create',
    });
    if (!tituloNovo || !tituloNovo.trim()) return;
    const nova = await criarObraVinculada(id, {
      tipo: (tipoNovo === 'novel' ? 'Novel' : 'Manga') as Tipo,
      titulo: tituloNovo.trim(),
      // Bloco B2: a obra correspondente nasce com os campos espelhados copiados
      // da origem (titulos_alternativos, generos, tags). Daí em diante o
      // espelhamento contínuo (B1) mantém os quatro campos sincronizados.
      titulos_alternativos: obra.titulos_alternativos,
      autor: null,
      capa_url: null,
      capitulo_atual: null,
      status_leitura: null,
      status_publicacao: null,
      fim_de_temporada: false,
      ultimo_capitulo_lancado: null,
      ultimo_capitulo_via_scraper: false,
      nota: null,
      generos: obra.generos,
      tags: obra.tags,
      observacoes: null,
      obra_vinculada_id: null,
      classificacao: null,
      // O link do NU refere-se à história: a contraparte nasce com o mesmo link (E6).
      novelupdates_url: obra.novelupdates_url,
      pdf: false,
    });
    mostrarToast(`"${nova.titulo}" created and linked ✓`);
    return nova;
  }

  /**
   * Correção manual de tipo de uma fonte (Bloco B4). Quando o novo tipo diverge
   * do tipo da obra atual, move a fonte pra contraparte vinculada — se não
   * houver uma compatível, oferece criar. tipo_manual=true impede o scraper de
   * reatribuir a fonte de volta.
   */
  async function handleMudarTipoFonte(fonte: Fonte, novoTipo: FamiliaTipo | null) {
    if (!obra) return;
    if (!novoTipo) {
      await setFonteTipo(fonte.id, null);
      return;
    }

    const familiaAtual = familiaDeTipo(obra.tipo);
    if (familiaAtual === null || familiaAtual === novoTipo) {
      await setFonteTipo(fonte.id, novoTipo);
      return;
    }

    if (obraVinculada && familiaDeTipo(obraVinculada.tipo) === novoTipo) {
      await setFonteTipo(fonte.id, novoTipo, obraVinculada.id);
      mostrarToast(`Source moved to "${obraVinculada.titulo}"`);
      return;
    }

    const tipoLabel = novoTipo === 'novel' ? 'novel' : 'manga';
    const criarContraparte = await confirmar({
      titulo: 'Type mismatch',
      mensagem: `This source looks like a ${tipoLabel}, but "${obra.titulo}" is registered as ${obra.tipo ?? '—'}. Create the corresponding ${tipoLabel} work and move this source there?`,
      confirmarRotulo: 'Create and move',
    });
    if (criarContraparte) {
      // Fluxo encadeado: se o pedido de título for cancelado, handleCriarVinculada
      // retorna undefined e nada é gravado — mesmo comportamento do prompt nativo.
      const nova = await handleCriarVinculada(novoTipo);
      if (nova) await setFonteTipo(fonte.id, novoTipo, nova.id);
    } else {
      await setFonteTipo(fonte.id, novoTipo);
    }
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
      <button type="button" className="voltar" onClick={() => navigate(-1)}>
        ← Back
      </button>

      <div className="detalhe-obra-form">
        <label>
          Title
          <input type="text" value={draft.titulo} onChange={(e) => setCampo('titulo', e.target.value)} />
        </label>

        <TagPicker
          label="Alternative title"
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

            {/* Corresponding work — Bloco D: "×" pequeno no lugar de "Unlink". */}
            <div className="vinculo-obra">
              {obraVinculada ? (
                <span className="vinculo-obra-linha">
                  Corresponding work: <Link to={`/obra/${obraVinculada.id}`}>{obraVinculada.titulo}</Link>
                  <button
                    type="button"
                    className="btn-icone btn-icone-perigo"
                    onClick={handleDesvincular}
                    aria-label="Unlink corresponding work"
                    title="Unlink"
                  >
                    <IconeX />
                  </button>
                </span>
              ) : (
                <>
                  <label className="check-inline">
                    <input
                      type="checkbox"
                      checked={mostrarVinculo}
                      onChange={(e) => setMostrarVinculo(e.target.checked)}
                    />
                    This work has a corresponding novel/manga?
                  </label>
                  {mostrarVinculo && (
                    <div className="vinculo-obra-acoes">
                      <VinculoObraSelect excluirId={id} value={vinculoEscolhidoId} onChange={setVinculoEscolhidoId} />
                      <button type="button" onClick={handleVincular} disabled={!vinculoEscolhidoId}>
                        Link
                      </button>
                      <span>or</span>
                      <button
                        type="button"
                        onClick={() => handleCriarVinculada(familiaDeTipo(draft.tipo) === 'novel' ? 'manga' : 'novel')}
                      >
                        Create
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Novel Updates — Bloco E7: livrinho (aberto em nova aba) + ×, ou + pra adicionar. */}
            <div className="novelupdates-campo">
              <span className="novelupdates-label">Novel Updates</span>
              <div className="novelupdates-acoes">
                {draft.novelupdates_url ? (
                  <>
                    <a
                      className="btn-icone"
                      href={draft.novelupdates_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open on Novel Updates"
                      title="Open on Novel Updates"
                    >
                      <IconeLivro />
                    </a>
                    <button
                      type="button"
                      className="btn-icone btn-icone-perigo"
                      onClick={handleRemoverNU}
                      aria-label="Remove Novel Updates link"
                      title="Remove"
                    >
                      <IconeX />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn-icone"
                    onClick={handleAdicionarNU}
                    aria-label="Add Novel Updates link"
                    title="Add Novel Updates link"
                  >
                    <IconeMais />
                  </button>
                )}
              </div>
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
              value={draft.nota ?? ''}
              onChange={(e) => setCampo('nota', e.target.value === '' ? null : Number(e.target.value))}
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

        <label>
          Notes
          <textarea
            value={notaDraft ?? ''}
            onChange={(e) => setNotaDraft(e.target.value || null)}
            rows={4}
          />
        </label>
        {notasDirty && (
          <div className="notas-acoes">
            <button type="button" className="btn-icone" onClick={handleSalvarNota} aria-label="Save notes" title="Save notes">
              <IconeDisquete />
            </button>
            <button
              type="button"
              className="btn-icone btn-icone-perigo"
              onClick={handleCancelarNota}
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
        <div className="modal-backdrop">
          <div className="modal">
            <p>You have unsaved notes on this work.</p>
            <div className="modal-acoes">
              <button
                type="button"
                onClick={async () => {
                  await handleSalvarNota();
                  blocker.proceed();
                }}
              >
                Save and leave
              </button>
              <button
                type="button"
                onClick={() => {
                  handleCancelarNota();
                  blocker.proceed();
                }}
              >
                Discard and leave
              </button>
              <button type="button" onClick={() => blocker.reset()}>
                Keep editing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
