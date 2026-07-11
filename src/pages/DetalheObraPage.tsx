import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../db/localDb';
import { createFonte, deleteFonte, deleteObra, setFonteAprovacao, updateObra } from '../db/repo';
import { useListasPorCategoria } from '../hooks/useListas';
import { TagPicker } from '../components/TagPicker';
import type { StatusAprovacao } from '../types';

function statusBadgeClasse(status: StatusAprovacao): string {
  if (status === 'aprovado') return 'badge badge-aprovado';
  if (status === 'rejeitado') return 'badge badge-rejeitado';
  return 'badge badge-pendente';
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

  const [novaFonteSite, setNovaFonteSite] = useState('');
  const [novaFonteUrl, setNovaFonteUrl] = useState('');

  if (!id) return null;
  if (obra === undefined) return <p>Carregando…</p>;

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
          <input
            type="text"
            value={obra.titulo}
            onChange={(e) => updateObra(id, { titulo: e.target.value })}
          />
        </label>

        <label>
          Autor
          <input
            type="text"
            value={obra.autor ?? ''}
            onChange={(e) => updateObra(id, { autor: e.target.value || null })}
          />
        </label>

        <label>
          Capa (URL)
          <input
            type="text"
            value={obra.capa_url ?? ''}
            onChange={(e) => updateObra(id, { capa_url: e.target.value || null })}
          />
        </label>

        <div className="detalhe-obra-grid">
          <label>
            Tipo
            <select
              value={obra.tipo ?? ''}
              onChange={(e) => updateObra(id, { tipo: (e.target.value || null) as typeof obra.tipo })}
            >
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
              value={obra.status_leitura ?? ''}
              onChange={(e) =>
                updateObra(id, { status_leitura: (e.target.value || null) as typeof obra.status_leitura })
              }
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
              value={obra.status_publicacao ?? ''}
              onChange={(e) =>
                updateObra(id, {
                  status_publicacao: (e.target.value || null) as typeof obra.status_publicacao,
                })
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
              value={obra.capitulo_atual ?? ''}
              onChange={(e) =>
                updateObra(id, { capitulo_atual: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
          </label>

          <label>
            Último capítulo disponível
            <input type="text" value={obra.ultimo_capitulo_lancado ?? '—'} disabled />
          </label>

          <label>
            Nota
            <select
              value={obra.nota ?? ''}
              onChange={(e) => updateObra(id, { nota: e.target.value === '' ? null : Number(e.target.value) })}
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
          value={obra.generos ?? []}
          options={generos}
          onChange={(v) => updateObra(id, { generos: v })}
        />

        <TagPicker label="Tags" value={obra.tags ?? []} options={tags} onChange={(v) => updateObra(id, { tags: v })} />

        <label>
          Observações
          <textarea
            value={obra.observacoes ?? ''}
            onChange={(e) => updateObra(id, { observacoes: e.target.value || null })}
            rows={4}
          />
        </label>

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
            type="text"
            placeholder="Site (ex: ezmanga)"
            value={novaFonteSite}
            onChange={(e) => setNovaFonteSite(e.target.value)}
          />
          <input
            type="url"
            placeholder="URL da fonte"
            value={novaFonteUrl}
            onChange={(e) => setNovaFonteUrl(e.target.value)}
            required
          />
          <button type="submit">Adicionar fonte</button>
        </form>
      </section>
    </div>
  );
}
