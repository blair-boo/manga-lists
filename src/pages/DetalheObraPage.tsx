import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type FormEvent } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import { db } from '../db/localDb';
import { createFonte, deleteFonte, deleteObra, setFonteAprovacao, updateObra, type NovaObra } from '../db/repo';
import { useListasPorCategoria } from '../hooks/useListas';
import { TagPicker } from '../components/TagPicker';
import { deriveSite } from '../lib/site';
import type { Obra, StatusAprovacao } from '../types';

function statusBadgeClasse(status: StatusAprovacao): string {
  if (status === 'aprovado') return 'badge badge-aprovado';
  if (status === 'rejeitado') return 'badge badge-rejeitado';
  return 'badge badge-pendente';
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

  const [novaFonteSite, setNovaFonteSite] = useState('');
  const [novaFonteUrl, setNovaFonteUrl] = useState('');
  const [siteEditadoManualmente, setSiteEditadoManualmente] = useState(false);

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
  if (obra === undefined || draft === null) return <p>Carregando…</p>;

  function setCampo<K extends keyof Draft>(campo: K, valor: Draft[K]) {
    setDraft((atual) => (atual ? { ...atual, [campo]: valor } : atual));
  }

  async function handleSalvar() {
    if (!id || !draft) return;
    await updateObra(id, draft as Partial<NovaObra>);
    setSavedSnapshot(draft);
  }

  function handleCancelar() {
    if (savedSnapshot) setDraft(savedSnapshot);
  }

  async function handleAdicionarFonte(e: FormEvent) {
    e.preventDefault();
    if (!novaFonteUrl.trim() || !id) return;
    await createFonte({
      obra_id: id,
      site: novaFonteSite.trim() || null,
      url: novaFonteUrl.trim(),
      ultimo_capitulo_detectado: null,
      confiavel: true,
      status_aprovacao: 'aprovado',
      descoberta_automaticamente: false,
      ultima_verificacao: null,
    });
    setNovaFonteSite('');
    setNovaFonteUrl('');
    setSiteEditadoManualmente(false);
  }

  function handleUrlFonteChange(v: string) {
    setNovaFonteUrl(v);
    if (!siteEditadoManualmente) setNovaFonteSite(deriveSite(v) ?? '');
  }

  function handleSiteFonteChange(v: string) {
    setNovaFonteSite(v);
    setSiteEditadoManualmente(true);
  }

  async function handleExcluirObra() {
    if (!id) return;
    if (!confirm(`Excluir "${obra?.titulo}" e todas as suas fontes?`)) return;
    await deleteObra(id);
    navigate('/');
  }

  return (
    <div className="detalhe-obra">
      <button type="button" className="voltar" onClick={() => navigate(-1)}>
        ← Voltar
      </button>

      <div className="detalhe-obra-form">
        <label>
          Título
          <input type="text" value={draft.titulo} onChange={(e) => setCampo('titulo', e.target.value)} />
        </label>

        <TagPicker
          label="Título alternativo"
          value={draft.titulos_alternativos ?? []}
          options={[]}
          onChange={(v) => setCampo('titulos_alternativos', v.length > 0 ? v : null)}
        />

        <label>
          Autor
          <input type="text" value={draft.autor ?? ''} onChange={(e) => setCampo('autor', e.target.value || null)} />
        </label>

        <label>
          Capa (URL)
          <input
            type="text"
            value={draft.capa_url ?? ''}
            onChange={(e) => setCampo('capa_url', e.target.value || null)}
          />
        </label>

        <div className="detalhe-obra-grid">
          <label>
            Tipo
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
            Status de leitura
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
            Status de publicação
            <select
              value={draft.status_publicacao ?? ''}
              onChange={(e) =>
                setCampo('status_publicacao', (e.target.value || null) as Draft['status_publicacao'])
              }
            >
              <option value="">—</option>
              {statusPublicacaoOpcoes.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>

          <label>
            Capítulo atual
            <input
              type="number"
              step="any"
              value={draft.capitulo_atual ?? ''}
              onChange={(e) => setCampo('capitulo_atual', e.target.value === '' ? null : Number(e.target.value))}
            />
          </label>

          <label>
            Nota
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
          label="Gêneros"
          value={draft.generos ?? []}
          options={generos}
          onChange={(v) => setCampo('generos', v)}
        />

        <TagPicker label="Tags" value={draft.tags ?? []} options={tags} onChange={(v) => setCampo('tags', v)} />

        <label>
          Observações
          <textarea
            value={draft.observacoes ?? ''}
            onChange={(e) => setCampo('observacoes', e.target.value || null)}
            rows={4}
          />
        </label>

        <div className="detalhe-obra-acoes">
          <button type="button" onClick={handleSalvar} disabled={!isDirty}>
            Salvar
          </button>
          <button type="button" onClick={handleCancelar} disabled={!isDirty}>
            Cancelar
          </button>
          {isDirty && <span className="alteracoes-pendentes">alterações não salvas</span>}
        </div>

        <button type="button" className="excluir-obra" onClick={handleExcluirObra}>
          Excluir obra
        </button>
      </div>

      <section className="fontes-section">
        <h2>Fontes</h2>
        <ul className="fontes-lista">
          {(fontes ?? []).map((f) => (
            <li key={f.id} className="fonte-item">
              <a href={f.url} target="_blank" rel="noreferrer">
                {f.site || f.url}
              </a>
              <span className={statusBadgeClasse(f.status_aprovacao)}>{f.status_aprovacao}</span>
              {f.ultimo_capitulo_detectado != null && <span>cap. {f.ultimo_capitulo_detectado}</span>}
              <div className="fonte-acoes">
                {f.status_aprovacao !== 'aprovado' && (
                  <button type="button" onClick={() => setFonteAprovacao(f.id, 'aprovado')}>
                    Aprovar
                  </button>
                )}
                {f.status_aprovacao !== 'rejeitado' && (
                  <button type="button" onClick={() => setFonteAprovacao(f.id, 'rejeitado')}>
                    Rejeitar
                  </button>
                )}
                <button type="button" onClick={() => deleteFonte(f.id)}>
                  Excluir
                </button>
              </div>
            </li>
          ))}
          {(fontes ?? []).length === 0 && <li className="fontes-vazio">Nenhuma fonte cadastrada.</li>}
        </ul>

        <form className="nova-fonte-form" onSubmit={handleAdicionarFonte}>
          <input
            type="url"
            placeholder="URL da fonte"
            value={novaFonteUrl}
            onChange={(e) => handleUrlFonteChange(e.target.value)}
            required
          />
          <input
            type="text"
            placeholder="Site (auto)"
            value={novaFonteSite}
            onChange={(e) => handleSiteFonteChange(e.target.value)}
          />
          <button type="submit">Adicionar fonte</button>
        </form>
      </section>

      {blocker.state === 'blocked' && (
        <div className="modal-backdrop">
          <div className="modal">
            <p>Você tem alterações não salvas nesta obra.</p>
            <div className="modal-acoes">
              <button
                type="button"
                onClick={async () => {
                  await handleSalvar();
                  blocker.proceed();
                }}
              >
                Salvar e sair
              </button>
              <button
                type="button"
                onClick={() => {
                  handleCancelar();
                  blocker.proceed();
                }}
              >
                Descartar e sair
              </button>
              <button type="button" onClick={() => blocker.reset()}>
                Continuar editando
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
