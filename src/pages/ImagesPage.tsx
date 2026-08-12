import { useEffect, useMemo, useState } from 'react';
import { useDialogos } from '../components/Dialogo';
import { useToast } from '../components/Toast';
import { detectarColisoesNaLista } from '../lib/imagensLista';
import { suportaDirectoryPicker } from '../lib/imagensLocal';
import type { ItemImagem } from '../lib/imagensTipos';
import { useImportacaoImagens } from '../lib/useImportacaoImagens';

const ROTULO_STATUS: Record<ItemImagem['status'], string> = {
  pendente: 'Pending',
  baixando: 'Downloading…',
  sucesso: 'Done',
  erro: 'Error',
};

function truncarUrl(url: string): string {
  return url.length > 60 ? `${url.slice(0, 57)}…` : url;
}

function mensagemErro(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Settings > Images: cola links (ou sobe um CSV/XLSX de link+nome), revisa
 * numa tabela editável e importa pro destino escolhido (Local device ou
 * Supabase Storage — Google Drive fica pra uma fase futura, ver plano).
 * Todo o baixar/gravar de verdade fica em src/lib/useImportacaoImagens.ts;
 * este componente só monta a UI e traduz resultado em toasts.
 */
export function ImagesPage() {
  const { confirmar } = useDialogos();
  const { mostrarToast } = useToast();
  const {
    itens,
    destino,
    setDestino,
    pastaSupabase,
    setPastaSupabase,
    pastasSupabase,
    carregandoPastas,
    carregarPastasSupabase,
    criarPastaSupabaseUi,
    pastaLocal,
    escolherPastaLocalUi,
    precisaEscolherPastaLocal,
    rodando,
    adicionarLinksColados,
    handleArquivoSelecionado,
    editarNome,
    removerItem,
    limparTudo,
    iniciarImportacao,
    retentarItemUi,
  } = useImportacaoImagens();

  const [textoColado, setTextoColado] = useState('');
  const [novaPastaSupabase, setNovaPastaSupabase] = useState('');
  const [criandoPasta, setCriandoPasta] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (destino === 'supabase') void carregarPastasSupabase();
    // Só precisa recarregar quando a usuária troca de destino, não a cada render.
    // eslint-disable-next-line
  }, [destino]);

  const colisoes = useMemo(() => detectarColisoesNaLista(itens), [itens]);
  const pendentesCount = useMemo(() => itens.filter((i) => i.status === 'pendente').length, [itens]);
  const podeImportar = pendentesCount > 0 && !rodando && !precisaEscolherPastaLocal;

  function avisarContagem(adicionados: number, invalidos: number, duplicados: number) {
    const partes: string[] = [];
    if (adicionados > 0) partes.push(`${adicionados} added`);
    if (duplicados > 0) partes.push(`${duplicados} duplicate(s) skipped`);
    if (invalidos > 0) partes.push(`${invalidos} invalid skipped`);
    if (partes.length === 0) return;
    mostrarToast(partes.join(', '), adicionados > 0 ? 'ok' : 'info');
  }

  function onAdicionarColados() {
    if (!textoColado.trim()) return;
    const { adicionados, invalidos, duplicados } = adicionarLinksColados(textoColado);
    setTextoColado('');
    avisarContagem(adicionados, invalidos, duplicados);
  }

  const onArquivoChange = handleArquivoSelecionado(
    (mensagem) => mostrarToast(`Could not read file: ${mensagem}`, 'erro'),
    ({ adicionados, invalidos, duplicados }) => avisarContagem(adicionados, invalidos, duplicados)
  );

  async function onEscolherPastaLocal() {
    try {
      await escolherPastaLocalUi();
    } catch (err) {
      mostrarToast(`Could not access folder: ${mensagemErro(err)}`, 'erro');
    }
  }

  async function onCriarPastaSupabase() {
    const nome = novaPastaSupabase.trim();
    if (!nome) return;
    setCriandoPasta(true);
    try {
      await criarPastaSupabaseUi(nome);
      setNovaPastaSupabase('');
      mostrarToast(`Folder "${nome}" created`);
    } catch (err) {
      mostrarToast(`Could not create folder: ${mensagemErro(err)}`, 'erro');
    } finally {
      setCriandoPasta(false);
    }
  }

  async function onLimparTudo() {
    if (itens.length === 0) return;
    const ok = await confirmar({
      titulo: 'Clear all',
      mensagem: `Remove all ${itens.length} item(s) from the list? Items already imported successfully stay wherever they were saved.`,
      confirmarRotulo: 'Clear',
      perigoso: true,
    });
    if (ok) limparTudo();
  }

  async function onImportar() {
    setErro(null);
    try {
      const { sucesso, erro: erros } = await iniciarImportacao();
      if (erros > 0) mostrarToast(`${sucesso} succeeded, ${erros} failed`, sucesso > 0 ? 'info' : 'erro');
      else mostrarToast(`${sucesso} image(s) imported`);
    } catch (err) {
      setErro(mensagemErro(err));
    }
  }

  async function onRetentar(id: string) {
    try {
      await retentarItemUi(id);
    } catch (err) {
      mostrarToast(`Retry failed: ${mensagemErro(err)}`, 'erro');
    }
  }

  return (
    <div className="images-pagina">
      <div className="images-cabecalho">
        <h1>Images</h1>
        <p className="images-subtitulo">
          Paste image links, or upload a CSV/XLSX file with a link column and a name column, then pick where to save them.
        </p>
      </div>

      <section className="images-secao">
        <h2>1. Add links</h2>
        <textarea
          className="images-textarea"
          placeholder="Paste one or more image links — separate with ; or a new line"
          value={textoColado}
          onChange={(e) => setTextoColado(e.target.value)}
          rows={4}
        />
        <div className="images-secao-acoes">
          <button type="button" onClick={onAdicionarColados} disabled={!textoColado.trim()}>
            Add links
          </button>
          <label className="images-upload-label">
            <input
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={onArquivoChange}
              hidden
            />
            <span className="images-upload-botao">Upload CSV/XLSX (link + name)</span>
          </label>
        </div>
      </section>

      <section className="images-secao">
        <h2>2. Destination</h2>
        <div className="images-destino">
          <label className="images-destino-opcao">
            <input type="radio" name="destino" checked={destino === 'supabase'} onChange={() => setDestino('supabase')} />
            Supabase
          </label>
          <label className="images-destino-opcao">
            <input type="radio" name="destino" checked={destino === 'local'} onChange={() => setDestino('local')} />
            Local device
          </label>
        </div>

        {destino === 'supabase' && (
          <div className="images-pasta-picker">
            <select
              value={pastaSupabase}
              onChange={(e) => setPastaSupabase(e.target.value)}
              disabled={carregandoPastas}
              aria-label="Folder"
            >
              <option value="">(root)</option>
              {pastasSupabase.map((pasta) => (
                <option key={pasta} value={pasta}>
                  {pasta}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="New folder name"
              value={novaPastaSupabase}
              onChange={(e) => setNovaPastaSupabase(e.target.value)}
              aria-label="New folder name"
            />
            <button type="button" onClick={() => void onCriarPastaSupabase()} disabled={!novaPastaSupabase.trim() || criandoPasta}>
              {criandoPasta ? 'Creating…' : '+ New folder'}
            </button>
          </div>
        )}

        {destino === 'local' &&
          (suportaDirectoryPicker() ? (
            <div className="images-pasta-picker">
              <button type="button" onClick={() => void onEscolherPastaLocal()}>
                {pastaLocal ? `Folder: ${pastaLocal.name}` : 'Choose folder…'}
              </button>
              <span className="images-pasta-dica">The folder picker also lets you create a new folder.</span>
            </div>
          ) : (
            <p className="images-pasta-dica">
              This browser can't target a specific folder (Chrome/Edge only) — files download one by one into your
              default Downloads folder instead.
            </p>
          ))}
      </section>

      <section className="images-secao">
        <h2>3. Review ({itens.length})</h2>
        {itens.length === 0 ? (
          <p className="images-vazio">No images added yet.</p>
        ) : (
          <>
            <div className="images-tabela-wrap">
              <table className="images-tabela">
                <thead>
                  <tr>
                    <th>URL</th>
                    <th>Name</th>
                    <th>Origin</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {itens.map((item) => (
                    <tr key={item.id} className={colisoes.has(item.id) ? 'images-linha-colisao' : ''}>
                      <td className="images-celula-url" title={item.url}>
                        {truncarUrl(item.url)}
                      </td>
                      <td>
                        <input
                          value={item.nome}
                          onChange={(e) => editarNome(item.id, e.target.value)}
                          disabled={item.status === 'baixando' || item.status === 'sucesso'}
                          aria-label="File name"
                        />
                      </td>
                      <td>{item.origem === 'colado' ? 'Pasted' : 'File'}</td>
                      <td>
                        <span className={`images-badge-status images-badge-${item.status}`}>{ROTULO_STATUS[item.status]}</span>
                        {item.status === 'erro' && item.erro && (
                          <span className="images-erro-linha" title={item.erro}>
                            {item.erro}
                          </span>
                        )}
                      </td>
                      <td className="images-celula-acoes">
                        {item.status === 'erro' && (
                          <button
                            type="button"
                            className="btn-icone"
                            onClick={() => void onRetentar(item.id)}
                            title="Retry"
                            aria-label="Retry"
                          >
                            ↻
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-icone btn-icone-perigo"
                          onClick={() => removerItem(item.id)}
                          disabled={item.status === 'baixando'}
                          title="Remove"
                          aria-label="Remove"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {colisoes.size > 0 && (
              <p className="images-aviso">Some names collide — they'll get a "-2" suffix automatically when imported.</p>
            )}
          </>
        )}
      </section>

      {erro && <p className="images-erro-geral">{erro}</p>}

      <div className="images-acoes-finais">
        <button type="button" onClick={() => void onLimparTudo()} disabled={itens.length === 0 || rodando}>
          Clear all
        </button>
        <button type="button" onClick={() => void onImportar()} disabled={!podeImportar}>
          {rodando ? 'Importing…' : pendentesCount > 0 ? `Import (${pendentesCount})` : 'Import'}
        </button>
      </div>
    </div>
  );
}
