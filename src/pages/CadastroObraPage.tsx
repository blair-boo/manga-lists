import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createFonte, createObra } from '../db/repo';
import { useListasPorCategoria } from '../hooks/useListas';
import { TagPicker } from '../components/TagPicker';
import { CapaUploader } from '../components/CapaUploader';
import { deriveSite } from '../lib/site';
import type { StatusLeitura, StatusPublicacao, Tipo } from '../types';

export function CadastroObraPage() {
  const navigate = useNavigate();
  const tipos = useListasPorCategoria('tipo');
  const statusLeituraOpcoes = useListasPorCategoria('status_leitura');
  const statusPublicacaoOpcoes = useListasPorCategoria('status_publicacao');
  const generosOpcoes = useListasPorCategoria('genero');
  const tagsOpcoes = useListasPorCategoria('tag');

  const [titulo, setTitulo] = useState('');
  const [titulosAlternativos, setTitulosAlternativos] = useState<string[]>([]);
  const [tipo, setTipo] = useState('');
  const [autor, setAutor] = useState('');
  const [capaUrl, setCapaUrl] = useState('');
  const [capituloAtual, setCapituloAtual] = useState('');
  const [statusLeitura, setStatusLeitura] = useState('');
  const [statusPublicacao, setStatusPublicacao] = useState('');
  const [nota, setNota] = useState('');
  const [generos, setGeneros] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [observacoes, setObservacoes] = useState('');
  const [urlsFontes, setUrlsFontes] = useState<string[]>(['']);

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
    if (!titulo.trim()) return;
    const obra = await createObra({
      titulo: titulo.trim(),
      titulos_alternativos: titulosAlternativos.length > 0 ? titulosAlternativos : null,
      tipo: (tipo || null) as Tipo | null,
      autor: autor.trim() || null,
      capa_url: capaUrl.trim() || null,
      capitulo_atual: capituloAtual === '' ? null : Number(capituloAtual),
      status_leitura: (statusLeitura || null) as StatusLeitura | null,
      status_publicacao: (statusPublicacao || null) as StatusPublicacao | null,
      ultimo_capitulo_lancado: null,
      ultimo_capitulo_via_scraper: false,
      nota: nota === '' ? null : Number(nota),
      generos: generos.length > 0 ? generos : null,
      tags: tags.length > 0 ? tags : null,
      observacoes: observacoes.trim() || null,
    });

    for (const url of urlsFontes.map((u) => u.trim()).filter(Boolean)) {
      await createFonte({
        obra_id: obra.id,
        site: deriveSite(url),
        url,
        ultimo_capitulo_detectado: null,
        atualizado_por_scraper: false,
        confiavel: true,
        status_aprovacao: 'aprovado',
        descoberta_automaticamente: false,
        ultima_verificacao: null,
      });
    }

    navigate(`/obra/${obra.id}`);
  }

  return (
    <form className="cadastro-obra-form" onSubmit={handleSubmit}>
      <h2>Nova obra</h2>
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

      <div className="detalhe-obra-grid">
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

        <label>
          Status de leitura
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

        <label>
          Capítulo atual
          <input type="number" step="any" value={capituloAtual} onChange={(e) => setCapituloAtual(e.target.value)} />
        </label>

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
      </div>

      <TagPicker label="Gêneros" value={generos} options={generosOpcoes} onChange={setGeneros} />
      <TagPicker label="Tags" value={tags} options={tagsOpcoes} onChange={setTags} />

      <label>
        Observações
        <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={4} />
      </label>

      <div className="urls-fontes">
        <span className="urls-fontes-label">Url da fonte</span>
        {urlsFontes.map((url, i) => (
          <div key={i} className="urls-fontes-linha">
            <input type="url" value={url} onChange={(e) => handleUrlChange(i, e.target.value)} placeholder="https://…" />
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

      <button type="submit">Salvar</button>
    </form>
  );
}
