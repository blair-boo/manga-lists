import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import { db } from '../db/localDb';
import { createFonte, deleteFonte, deleteObra, setFonteAprovacao, updateFonte, updateObra, type NovaObra } from '../db/repo';
import { useListasPorCategoria } from '../hooks/useListas';
import { TagPicker } from '../components/TagPicker';
import { CapaUploader } from '../components/CapaUploader';
import { StatusScraper } from '../components/StatusScraper';
import { useToast } from '../components/Toast';
import { deriveSite } from '../lib/site';
import { dominioDeUrl, registrarDominioManual } from '../lib/scraperConfig';
import type { Fonte, Obra, StatusAprovacao } from '../types';

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

function FonteItem({ fonte }: { fonte: Fonte }) {
  const [capitulo, setCapitulo] = useState(fonte.ultimo_capitulo_detectado?.toString() ?? '');
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
        {fonte.site || dominioDeUrl(fonte.url) || fonte.url}
      </a>
      <span className={statusBadgeClasse(fonte.status_aprovacao)}>{statusAprovacaoLabel(fonte.status_aprovacao)}</span>
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
  | 'generos'
  | 'tags'
  | 'observacoes'
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
    generos: obra.generos,
    tags: obra.tags,
    observacoes: obra.observacoes,
  };
}

export function DetalheObraPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { mostrarToast } = useToast();
  const obra = useLiveQuery(() => (id ? db.obras.get(id) : undefined), [id]);
  const fontes = useLiveQuery(() => (id ? db.fontes.where('obra_id').equals(id).toArray() : []), [id]);

  const tipos = useListasPorCategoria('tipo');
  const statusLeituraOpcoes = useListasPorCategoria('status_leitura');
  const statusPublicacaoOpcoes = useListasPorCategoria('status_publicacao');
  const generos = useListasPorCategoria('genero');
  const tags = useListasPorCategoria('tag');

  const [obraIdCarregado, setObraIdCarregado] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<Draft | null>(null);

  const [novaFonteUrl, setNovaFonteUrl] = useState('');

  useEffect(() => {
    if (obra && obra.id !== obraIdCarregado) {
      const d = toDraft(obra);
      setDraft(d);
      setSavedSnapshot(d);
      setObraIdCarregado(obra.id);
    }
  }, [obra, obraIdCarregado]);

  const isDirty = draft !== null && savedSnapshot !== null && JSON.stringify(draft) !== JSON.stringify(savedSnapshot);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => isDirty && currentLocation.pathname !== nextLocation.pathname
  );

  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  if (!id) return null;
  if (obra === undefined || draft === null) return <p>Loading…</p>;

  function setCampo<K extends keyof Draft>(campo: K, valor: Draft[K]) {
    setDraft((atual) => (atual ? { ...atual, [campo]: valor } : atual));
  }

  async function handleSalvar() {
    if (!id || !draft) return;
    await updateObra(id, draft as Partial<NovaObra>);
    setSavedSnapshot(draft);
    mostrarToast('Saved ✓');
  }

  function handleCancelar() {
    if (savedSnapshot) setDraft(savedSnapshot);
  }

  async function handleAdicionarFonte(e: FormEvent) {
    e.preventDefault();
    if (!novaFonteUrl.trim() || !id) return;
    const url = novaFonteUrl.trim();
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
    });
    void registrarDominioManual(url); // domínio novo inserido à mão vira site suportado
    setNovaFonteUrl('');
  }

  async function handleExcluirObra() {
    if (!id) return;
    if (!confirm(`Delete "${obra?.titulo}" and all its sources?`)) return;
    await deleteObra(id);
    navigate('/');
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

        <label>
          Author
          <input type="text" value={draft.autor ?? ''} onChange={(e) => setCampo('autor', e.target.value || null)} />
        </label>

        <label>
          Cover (URL)
          <input
            type="text"
            value={draft.capa_url ?? ''}
            onChange={(e) => setCampo('capa_url', e.target.value || null)}
          />
        </label>
        <CapaUploader onUploaded={(url) => setCampo('capa_url', url)} />
        {draft.capa_url && (
          <img src={draft.capa_url} alt="Cover preview" className="capa-preview" />
        )}

        <div className="detalhe-obra-grid">
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
        </div>

        <TagPicker
          label="Genres"
          value={draft.generos ?? []}
          options={generos}
          onChange={(v) => setCampo('generos', v)}
        />

        <TagPicker label="Tags" value={draft.tags ?? []} options={tags} onChange={(v) => setCampo('tags', v)} />

        <label>
          Notes
          <textarea
            value={draft.observacoes ?? ''}
            onChange={(e) => setCampo('observacoes', e.target.value || null)}
            rows={4}
          />
        </label>

        <div className="detalhe-obra-acoes">
          <button type="button" onClick={handleSalvar} disabled={!isDirty}>
            Save
          </button>
          <button type="button" onClick={handleCancelar} disabled={!isDirty}>
            Cancel
          </button>
          {isDirty && <span className="alteracoes-pendentes">unsaved changes</span>}
        </div>

        <button type="button" className="excluir-obra" onClick={handleExcluirObra}>
          Delete work
        </button>
      </div>

      <section className="fontes-section">
        <h2>Sources</h2>
        <ul className="fontes-lista">
          {(fontes ?? []).map((f) => (
            <FonteItem key={f.id} fonte={f} />
          ))}
          {(fontes ?? []).length === 0 && <li className="fontes-vazio">No sources yet.</li>}
        </ul>

        <form className="nova-fonte-form" onSubmit={handleAdicionarFonte}>
          <input
            type="url"
            placeholder="Source URL"
            value={novaFonteUrl}
            onChange={(e) => setNovaFonteUrl(e.target.value)}
            required
          />
          <button type="submit">Add source</button>
        </form>
      </section>

      {blocker.state === 'blocked' && (
        <div className="modal-backdrop">
          <div className="modal">
            <p>You have unsaved changes on this work.</p>
            <div className="modal-acoes">
              <button
                type="button"
                onClick={async () => {
                  await handleSalvar();
                  blocker.proceed();
                }}
              >
                Save and leave
              </button>
              <button
                type="button"
                onClick={() => {
                  handleCancelar();
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
