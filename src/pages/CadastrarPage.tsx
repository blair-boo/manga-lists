import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { criarObraComFontes, vincularObras, type NovaObra } from '../db/repo';
import { useListasPorCategoria } from '../hooks/useListas';
import { TagPicker } from '../components/TagPicker';
import { CapaUploader } from '../components/CapaUploader';
import { VinculoObraSelect } from '../components/VinculoObraSelect';
import { useToast } from '../components/Toast';
import { registrarDominioManual } from '../lib/scraperConfig';
import type { Classificacao, Obra, StatusLeitura, StatusPublicacao, Tipo } from '../types';

interface Resultado {
  obra: Obra;
  jaExistia: boolean;
}

export function CadastrarPage() {
  const tipos = useListasPorCategoria('tipo');
  const statusLeituraOpcoes = useListasPorCategoria('status_leitura');
  const statusPublicacaoOpcoes = useListasPorCategoria('status_publicacao');
  const generosOpcoes = useListasPorCategoria('genero');
  const tagsOpcoes = useListasPorCategoria('tag');
  const { mostrarToast } = useToast();

  // Campos do cadastro rápido (sempre visíveis)
  const [titulo, setTitulo] = useState('');
  const [titulosAlternativos, setTitulosAlternativos] = useState<string[]>([]);
  const [capaUrl, setCapaUrl] = useState('');
  const [statusLeitura, setStatusLeitura] = useState('');
  const [capituloAtual, setCapituloAtual] = useState('');
  const [urlsFontes, setUrlsFontes] = useState<string[]>(['']);

  // Campos exclusivos do cadastro completo (revelados pelo botão)
  const [tipo, setTipo] = useState('');
  const [statusPublicacao, setStatusPublicacao] = useState('');
  const [fimDeTemporada, setFimDeTemporada] = useState(false);
  const [nota, setNota] = useState('');
  const [classificacao, setClassificacao] = useState<Classificacao | null>(null);
  const [pdf, setPdf] = useState(false);

  function handleStatusPublicacao(v: string) {
    setStatusPublicacao(v);
    if (v !== 'Hiatus') setFimDeTemporada(false); // não deixa "End of Season" órfão
  }
  const [generos, setGeneros] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [observacoes, setObservacoes] = useState('');
  const [temVinculo, setTemVinculo] = useState(false);
  const [obraVinculadaId, setObraVinculadaId] = useState('');

  const [completo, setCompleto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  function limparFormulario() {
    setTitulo('');
    setTitulosAlternativos([]);
    setCapaUrl('');
    setStatusLeitura('');
    setCapituloAtual('');
    setUrlsFontes(['']);
    setTipo('');
    setStatusPublicacao('');
    setFimDeTemporada(false);
    setNota('');
    setClassificacao(null);
    setPdf(false);
    setGeneros([]);
    setTags([]);
    setObservacoes('');
    setTemVinculo(false);
    setObraVinculadaId('');
  }

  function handleUrlChange(index: number, valor: string) {
    setUrlsFontes((atual) => atual.map((u, i) => (i === index ? valor : u)));
  }

  function adicionarUrl() {
    setUrlsFontes((atual) => [...atual, '']);
  }

  function removerUrl(index: number) {
    setUrlsFontes((atual) => atual.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const urlsValidas = urlsFontes.map((u) => u.trim()).filter(Boolean);
    if (!titulo.trim() || !tipo) return;

    setSalvando(true);
    const obra: NovaObra = {
      tipo: (tipo || null) as Tipo | null,
      titulo: titulo.trim(),
      titulos_alternativos: titulosAlternativos.length > 0 ? titulosAlternativos : null,
      autor: null,
      capa_url: capaUrl.trim() || null,
      capitulo_atual: capituloAtual === '' ? null : Number(capituloAtual),
      status_leitura: (statusLeitura || null) as StatusLeitura | null,
      status_publicacao: (statusPublicacao || null) as StatusPublicacao | null,
      fim_de_temporada: statusPublicacao === 'Hiatus' ? fimDeTemporada : false,
      ultimo_capitulo_lancado: null,
      ultimo_capitulo_via_scraper: false,
      nota: nota === '' ? null : Number(nota),
      generos: generos.length > 0 ? generos : null,
      tags: tags.length > 0 ? tags : null,
      observacoes: observacoes.trim() || null,
      obra_vinculada_id: null,
      classificacao,
      novelupdates_url: null,
      pdf,
    };
    const r = await criarObraComFontes(obra, urlsValidas);
    setSalvando(false);
    setResultado(r);
    if (r.jaExistia) {
      mostrarToast('Work already exists', 'info');
    } else {
      // Fontes inseridas manualmente: registra domínios novos como sites suportados.
      for (const url of urlsValidas) void registrarDominioManual(url);
      if (temVinculo && obraVinculadaId) void vincularObras(r.obra.id, obraVinculadaId);
      mostrarToast('Work added ✓');
      limparFormulario();
      setCompleto(false);
    }
  }

  return (
    <div className="cadastrar">
      <h2>Add</h2>
      <p>Fields marked with * are required.</p>

      <form className="cadastro-obra-form" onSubmit={handleSubmit}>
        <label>
          Title *
          <input type="text" value={titulo} onChange={(e) => setTitulo(e.target.value)} required />
        </label>

        <div className="detalhe-obra-grid">
          <label>
            Type *
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} required>
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
            <select value={statusLeitura} onChange={(e) => setStatusLeitura(e.target.value)}>
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
              value={capituloAtual}
              onChange={(e) => setCapituloAtual(e.target.value)}
            />
          </label>

          {completo && (
            <label>
              Publication status
              <select value={statusPublicacao} onChange={(e) => handleStatusPublicacao(e.target.value)}>
                <option value="">—</option>
                {statusPublicacaoOpcoes.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          )}

          {completo && statusPublicacao === 'Hiatus' && (
            <label className="check-inline">
              <input
                type="checkbox"
                checked={fimDeTemporada}
                onChange={(e) => setFimDeTemporada(e.target.checked)}
              />
              End of Season
            </label>
          )}

          {completo && (
            <label>
              Rating
              <select value={nota} onChange={(e) => setNota(e.target.value)}>
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {'★'.repeat(n)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {completo && (
            <div className="classificacao-campo">
              <span className="classificacao-label">Content rating</span>
              <div className="classificacao-caixas">
                {(['R-15', 'R-18'] as Classificacao[]).map((c) => (
                  <label key={c} className="check-inline">
                    <input
                      type="checkbox"
                      checked={classificacao === c}
                      onChange={(e) => setClassificacao(e.target.checked ? c : null)}
                    />
                    {c}
                  </label>
                ))}
              </div>
            </div>
          )}

          {completo && (
            <div className="pdf-campo">
              <span className="pdf-label">PDF</span>
              <label className="check-inline">
                <input type="checkbox" checked={pdf} onChange={(e) => setPdf(e.target.checked)} />
                Yes
              </label>
            </div>
          )}
        </div>

        {completo && (
          <>
            <TagPicker
              label="Alternative title"
              value={titulosAlternativos}
              options={[]}
              onChange={setTitulosAlternativos}
            />

            {/* Bloco topo (C): capa clicável à esquerda; Corresponding work à direita. */}
            <div className="obra-topo">
              <div className="obra-topo-capa">
                <CapaUploader capaUrl={capaUrl || null} onUploaded={setCapaUrl} />
              </div>

              <div className="obra-topo-campos">
                <div className="vinculo-obra">
                  <label className="check-inline">
                    <input
                      type="checkbox"
                      checked={temVinculo}
                      onChange={(e) => {
                        setTemVinculo(e.target.checked);
                        if (!e.target.checked) setObraVinculadaId('');
                      }}
                    />
                    This work has a corresponding novel/manga?
                  </label>
                  {temVinculo && (
                    <label>
                      Corresponding work
                      <VinculoObraSelect value={obraVinculadaId} onChange={setObraVinculadaId} />
                    </label>
                  )}
                </div>
              </div>
            </div>

            <TagPicker label="Genres" value={generos} options={generosOpcoes} onChange={setGeneros} />
            <TagPicker label="Tags" value={tags} options={tagsOpcoes} onChange={setTags} />
            <label>
              Notes
              <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={4} />
            </label>
          </>
        )}

        <button
          type="button"
          className="toggle-completo"
          onClick={() => setCompleto((v) => !v)}
          aria-expanded={completo}
        >
          {completo ? '− Quick add' : '+ Full details'}
        </button>

        <div className="urls-fontes">
          <span className="urls-fontes-label">Source URL</span>
          {urlsFontes.map((url, i) => (
            <div key={i} className="urls-fontes-linha">
              <input
                type="url"
                value={url}
                onChange={(e) => handleUrlChange(i, e.target.value)}
                placeholder="https://…"
              />
              {urlsFontes.length > 1 && (
                <button type="button" onClick={() => removerUrl(i)} aria-label="Remove URL">
                  ×
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={adicionarUrl} className="adicionar-url">
            + Add another source
          </button>
        </div>

        <button type="submit" disabled={salvando}>
          {salvando ? 'Saving…' : 'Add'}
        </button>
      </form>

      {resultado && (
        <div className="cadastro-rapido-resultado">
          {resultado.jaExistia ? (
            <p>
              A work titled "{resultado.obra.titulo}" already exists.{' '}
              <Link to={`/obra/${resultado.obra.id}`}>View existing work</Link>
            </p>
          ) : (
            <p>
              "{resultado.obra.titulo}" added. <Link to={`/obra/${resultado.obra.id}`}>View work</Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
