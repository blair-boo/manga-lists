import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { mensagemDeErro } from '../lib/erros';
import { IconeRefresh } from '../components/Icones';
import { SeletorCor } from '../components/SeletorCor';
import '../styles/seletor-cor.css';

const BUCKET = 'icons';
const PASTA_COR_ORIGINAL = 'w-color';
const TAMANHO_PADRAO = 16;
const TAMANHO_MIN = 10;
const TAMANHO_MAX = 64;

interface IconeArquivo {
  nome: string;
  url: string;
}

async function listarIcones(pasta: string): Promise<IconeArquivo[]> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(pasta, { sortBy: { column: 'name', order: 'asc' } });
  if (error) throw error;
  const arquivos = (data ?? []).filter((item) => item.id !== null);
  return arquivos.map((item) => {
    const caminho = pasta ? `${pasta}/${item.name}` : item.name;
    return { nome: item.name, url: supabase.storage.from(BUCKET).getPublicUrl(caminho).data.publicUrl };
  });
}

/**
 * Tela de testes (depois da aba Add): permite conferir fonte e ícones (da
 * pasta "icons" do Supabase Storage) num tamanho ajustável — um controle só,
 * em vez de duplicar blocos fixos por tamanho.
 */
export function TestesPage() {
  const [tamanho, setTamanho] = useState(TAMANHO_PADRAO);
  const [icones, setIcones] = useState<IconeArquivo[]>([]);
  const [iconesCorOriginal, setIconesCorOriginal] = useState<IconeArquivo[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const conteudoRef = useRef<HTMLDivElement>(null);

  // Var própria (não --text-h): setar na .testes-conteudo escopa o efeito só
  // aos textos de exemplo da fonte e aos ícones da seção Icons, sem repintar
  // cabeçalhos, botões e outros ícones da página (que usam --text-h global).
  function aplicarCor(hex: string) {
    conteudoRef.current?.style.setProperty('--testes-cor-preview', hex);
  }

  const carregarIcones = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [raiz, corOriginal] = await Promise.all([listarIcones(''), listarIcones(PASTA_COR_ORIGINAL)]);
      setIcones(raiz);
      setIconesCorOriginal(corOriginal);
    } catch (err) {
      setErro(mensagemDeErro(err));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregarIcones();
  }, [carregarIcones]);

  function ajustarTamanho(valor: number) {
    if (Number.isNaN(valor)) return;
    setTamanho(Math.min(TAMANHO_MAX, Math.max(TAMANHO_MIN, valor)));
  }

  return (
    <div className="testes-pagina">
      {/* Área superior (sem scroll próprio): cabeçalho, controle de tamanho e
          seletor de cor. O conteúdo abaixo (fonte/ícones) tem seu próprio
          scroll, independente desta área — ver .testes-conteudo. */}
      <div className="testes-topo">
        <div className="testes-cabecalho">
          <h1>Tests</h1>
          <p className="testes-subtitulo">Preview fonts and icons at any size — no need to duplicate blocks per size.</p>
        </div>

        <div className="testes-controle-tamanho">
          <label className="testes-tamanho-label">
            Size
            <input
              type="range"
              min={TAMANHO_MIN}
              max={TAMANHO_MAX}
              value={tamanho}
              onChange={(e) => ajustarTamanho(Number(e.target.value))}
            />
            <input
              type="number"
              min={TAMANHO_MIN}
              max={TAMANHO_MAX}
              value={tamanho}
              onChange={(e) => ajustarTamanho(Number(e.target.value))}
              className="testes-tamanho-input"
            />
            px
            <button
              type="button"
              className={`btn-icone testes-refresh${carregando ? ' testes-refresh-carregando' : ''}`}
              onClick={() => void carregarIcones()}
              disabled={carregando}
              title={carregando ? 'Refreshing…' : 'Refresh icons'}
              aria-label={carregando ? 'Refreshing…' : 'Refresh icons'}
            >
              <IconeRefresh />
            </button>
          </label>
        </div>

        <section className="testes-secao testes-secao-cor">
          <h2>Icon color</h2>
          <SeletorCor onCorChange={aplicarCor} />
        </section>
      </div>

      <div className="testes-conteudo" ref={conteudoRef}>
        <section className="testes-secao">
          <h2>Font — {tamanho}px</h2>
          <div className="testes-fonte-amostra" style={{ fontSize: tamanho }}>
            <p>Regular — The quick brown fox jumps over the lazy dog.</p>
            <p style={{ fontWeight: 600 }}>Bold (600) — The quick brown fox jumps over the lazy dog.</p>
            <p style={{ fontStyle: 'italic' }}>Italic — The quick brown fox jumps over the lazy dog.</p>
            <p className="testes-fonte-muted">Muted (opacity 0.7) — hints and captions.</p>
          </div>
        </section>

        <section className="testes-secao">
          <h2>Icons — {tamanho}px</h2>
          {erro && <p className="testes-erro">Could not load icons: {erro}</p>}
          {!erro && !carregando && icones.length === 0 && <p>No icons found in the "{BUCKET}" folder.</p>}
          <div className="testes-icones-grid">
            {icones.map((icone) => (
              <div key={icone.nome} className="testes-icone-item">
                {/* Ícone "pintado" com mask (não <img>) pra acompanhar a cor
                    escolhida no seletor (ver .testes-icone-svg em testes.css). */}
                <span
                  className="testes-icone-svg"
                  role="img"
                  aria-label={icone.nome}
                  style={{
                    width: tamanho,
                    height: tamanho,
                    WebkitMaskImage: `url(${icone.url})`,
                    maskImage: `url(${icone.url})`,
                  }}
                />
                <span className="testes-icone-nome">{icone.nome}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="testes-secao">
          <h2>Icons (original color) — {tamanho}px</h2>
          {erro && <p className="testes-erro">Could not load icons: {erro}</p>}
          {!erro && !carregando && iconesCorOriginal.length === 0 && (
            <p>
              No icons found in the "{BUCKET}/{PASTA_COR_ORIGINAL}" folder.
            </p>
          )}
          <div className="testes-icones-grid">
            {iconesCorOriginal.map((icone) => (
              <div key={icone.nome} className="testes-icone-item">
                {/* Aqui não pintamos com mask: o SVG mantém a cor original do
                    arquivo (não segue o tema), só o tamanho é ajustável. */}
                <img
                  className="testes-icone-img"
                  src={icone.url}
                  alt={icone.nome}
                  width={tamanho}
                  height={tamanho}
                  style={{ width: tamanho, height: tamanho }}
                  loading="lazy"
                />
                <span className="testes-icone-nome">{icone.nome}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
