import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { criarObraRapida } from '../db/repo';
import { useListasPorCategoria } from '../hooks/useListas';
import { TagPicker } from '../components/TagPicker';
import type { Obra, StatusLeitura } from '../types';

interface Resultado {
  obra: Obra;
  jaExistia: boolean;
}

export function CadastroRapidoPage() {
  const statusLeituraOpcoes = useListasPorCategoria('status_leitura');

  const [titulo, setTitulo] = useState('');
  const [titulosAlternativos, setTitulosAlternativos] = useState<string[]>([]);
  const [autor, setAutor] = useState('');
  const [statusLeitura, setStatusLeitura] = useState('');
  const [capituloAtual, setCapituloAtual] = useState('');
  const [urlsFontes, setUrlsFontes] = useState<string[]>(['']);
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  function limparFormulario() {
    setTitulo('');
    setTitulosAlternativos([]);
    setAutor('');
    setStatusLeitura('');
    setCapituloAtual('');
    setUrlsFontes(['']);
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
    const r = await criarObraRapida({
      titulo: titulo.trim(),
      titulosAlternativos,
      autor: autor.trim() || null,
      statusLeitura: statusLeitura as StatusLeitura,
      capituloAtual: Number(capituloAtual),
      urlsFontes: urlsValidas,
    });
    setSalvando(false);
    setResultado(r);
    if (!r.jaExistia) limparFormulario();
  }

  return (
    <div className="cadastro-rapido">
      <h2>Cadastro rápido</h2>
      <p>Campos com * são obrigatórios.</p>

      <form onSubmit={handleSubmit}>
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
