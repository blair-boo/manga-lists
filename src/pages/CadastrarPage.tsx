import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { criarObraComFontes, type NovaObra } from '../db/repo';
import { useListasPorCategoria } from '../hooks/useListas';
import { TagPicker } from '../components/TagPicker';
import { CapaUploader } from '../components/CapaUploader';
import { useToast } from '../components/Toast';
import type { Obra, StatusLeitura, StatusPublicacao, Tipo } from '../types';

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
  const [autor, setAutor] = useState('');
  const [capaUrl, setCapaUrl] = useState('');
  const [statusLeitura, setStatusLeitura] = useState('');
  const [capituloAtual, setCapituloAtual] = useState('');
  const [urlsFontes, setUrlsFontes] = useState<string[]>(['']);

  // Campos exclusivos do cadastro completo (revelados pelo botão)
  const [tipo, setTipo] = useState('');
  const [statusPublicacao, setStatusPublicacao] = useState('');
  const [nota, setNota] = useState('');
  const [generos, setGeneros] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [observacoes, setObservacoes] = useState('');

  const [completo, setCompleto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  function limparFormulario() {
    setTitulo('');
    setTitulosAlternativos([]);
    setAutor('');
    setCapaUrl('');
    setStatusLeitura('');
    setCapituloAtual('');
    setUrlsFontes(['']);
    setTipo('');
    setStatusPublicacao('');
    setNota('');
    setGeneros([]);
    setTags([]);
    setObservacoes('');
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
    if (!titulo.trim() || !statusLeitura || capituloAtual === '' || urlsValidas.length === 0) return;

    setSalvando(true);
    const obra: NovaObra = {
      tipo: (tipo || null) as Tipo | null,
      titulo: titulo.trim(),
      titulos_alternativos: titulosAlternativos.length > 0 ? titulosAlternativos : null,
      autor: autor.trim() || null,
      capa_url: capaUrl.trim() || null,
      capitulo_atual: Number(capituloAtual),
      status_leitura: statusLeitura as StatusLeitura,
      status_publicacao: (statusPublicacao || null) as StatusPublicacao | null,
      ultimo_capitulo_lancado: null,
      ultimo_capitulo_via_scraper: false,
      nota: nota === '' ? null : Number(nota),
      generos: generos.length > 0 ? generos : null,
      tags: tags.length > 0 ? tags : null,
      observacoes: observacoes.trim() || null,
    };
    const r = await criarObraComFontes(obra, urlsValidas);
    setSalvando(false);
    setResultado(r);
    if (r.jaExistia) {
      mostrarToast('Obra já existente', 'info');
    } else {
      mostrarToast('Obra cadastrada ✓');
      limparFormulario();
      setCompleto(false);
    }
  }

  return (
    <div className="cadastrar">
      <h2>Cadastrar</h2>
      <p>Campos com * são obrigatórios.</p>

      <form className="cadastro-obra-form" onSubmit={handleSubmit}>
        <label>
          Título *
          <input type="text" value={titulo} onChange={(e) => setTitulo(e.target.value)} required />
        </label>

        <TagPicker
          label="Título alternativo"
          value={titulosAlternativos}
          options={[]}
          onChange={setTitulosAlternativos}
        />

        <label>
          Autor
          <input type="text" value={autor} onChange={(e) => setAutor(e.target.value)} />
        </label>

        <label>
          Capa (URL)
          <input type="text" value={capaUrl} onChange={(e) => setCapaUrl(e.target.value)} />
        </label>
        <CapaUploader onUploaded={setCapaUrl} />
        {capaUrl && <img src={capaUrl} alt="Prévia da capa" className="capa-preview" />}

        <button
          type="button"
          className="toggle-completo"
          onClick={() => setCompleto((v) => !v)}
          aria-expanded={completo}
        >
          {completo ? '− Cadastro rápido' : '+ Cadastro completo'}
        </button>

        <div className="detalhe-obra-grid">
          {completo && (
            <label>
              Tipo
              <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                <option value="">—</option>
                {tipos.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label>
            Status de leitura *
            <select value={statusLeitura} onChange={(e) => setStatusLeitura(e.target.value)} required>
              <option value="">—</option>
              {statusLeituraOpcoes.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>

          {completo && (
            <label>
              Status de publicação
              <select value={statusPublicacao} onChange={(e) => setStatusPublicacao(e.target.value)}>
                <option value="">—</option>
                {statusPublicacaoOpcoes.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label>
            Capítulo atual *
            <input
              type="number"
              step="any"
              value={capituloAtual}
              onChange={(e) => setCapituloAtual(e.target.value)}
              required
            />
          </label>

          {completo && (
            <label>
              Nota
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
        </div>

        {completo && (
          <>
            <TagPicker label="Gêneros" value={generos} options={generosOpcoes} onChange={setGeneros} />
            <TagPicker label="Tags" value={tags} options={tagsOpcoes} onChange={setTags} />
            <label>
              Observações
              <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={4} />
            </label>
          </>
        )}

        <div className="urls-fontes">
          <span className="urls-fontes-label">Url da fonte *</span>
          {urlsFontes.map((url, i) => (
            <div key={i} className="urls-fontes-linha">
              <input
                type="url"
                value={url}
                onChange={(e) => handleUrlChange(i, e.target.value)}
                placeholder="https://…"
                required={i === 0}
              />
              {urlsFontes.length > 1 && (
                <button type="button" onClick={() => removerUrl(i)} aria-label="Remover URL">
                  ×
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={adicionarUrl} className="adicionar-url">
            + Adicionar outra fonte
          </button>
        </div>

        <button type="submit" disabled={salvando}>
          {salvando ? 'Salvando…' : 'Cadastrar'}
        </button>
      </form>

      {resultado && (
        <div className="cadastro-rapido-resultado">
          {resultado.jaExistia ? (
            <p>
              Já existe uma obra com o título "{resultado.obra.titulo}".{' '}
              <Link to={`/obra/${resultado.obra.id}`}>Ver obra existente</Link>
            </p>
          ) : (
            <p>
              "{resultado.obra.titulo}" cadastrada. <Link to={`/obra/${resultado.obra.id}`}>Ver obra</Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
