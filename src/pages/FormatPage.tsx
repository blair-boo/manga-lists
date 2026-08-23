import type { Bloco } from '../lib/formatador/tipos';
import { useFormatador, type FormatoSaida } from '../lib/useFormatador';
import { useTemplateFormatacao } from '../lib/useTemplateFormatacao';

const ROTULO_FORMATO: Record<FormatoSaida, string> = { md: 'Markdown (.md)', docx: 'Word (.docx)', pdf: 'PDF (.pdf)', epub: 'EPUB (.epub)' };

type ItemPreview = Bloco | { tipo: 'lista'; itens: string[] };

/** Agrupa `item-lista` consecutivos numa única `<ul>` pra pré-visualização gerar HTML válido. */
function agruparParaPreview(blocos: Bloco[]): ItemPreview[] {
  const grupos: ItemPreview[] = [];
  for (const bloco of blocos) {
    const ultimo = grupos[grupos.length - 1];
    if (bloco.tipo === 'item-lista') {
      if (ultimo && ultimo.tipo === 'lista') ultimo.itens.push(bloco.texto);
      else grupos.push({ tipo: 'lista', itens: [bloco.texto] });
      continue;
    }
    grupos.push(bloco);
  }
  return grupos;
}

/**
 * Settings > Format: sobe um PDF/Markdown/Word, o conteúdo vira um documento
 * estruturado (título + títulos/parágrafos/listas/citações — ver
 * lib/formatador/tipos.ts), aplica um template (o "Custom" — derivado de um
 * .docx de referência, substituível a qualquer momento — ou um dos 3 presets)
 * e permite baixar o resultado nos 4 formatos (md/docx/pdf/epub).
 */
export function FormatPage() {
  const { nomeOriginal, documento, processando, erro, baixandoFormato, handleArquivoSelecionado, limpar, baixar } = useFormatador();
  const {
    opcoes,
    selecionadoId,
    setSelecionadoId,
    templateAtivo: template,
    carregandoPadrao,
    substituindo,
    erro: erroTemplate,
    substituirTemplate,
    resetarTemplate,
    temTemplateCustomizado,
  } = useTemplateFormatacao();

  return (
    <div className="format-pagina">
      <div className="format-cabecalho">
        <h1>Format</h1>
        <p className="format-subtitulo">
          Upload a PDF, Markdown or Word file, pick a formatting template, then download the result as Markdown, Word, PDF or EPUB.
        </p>
      </div>

      <section className="format-secao">
        <h2>1. Upload a file</h2>
        <label className="format-upload-label">
          <input type="file" accept=".pdf,.md,.markdown,.txt,.docx" onChange={(e) => void handleArquivoSelecionado(e)} hidden />
          <span className="format-upload-botao">{processando ? 'Reading…' : 'Choose PDF / Markdown / Word file'}</span>
        </label>
        {nomeOriginal && !processando && (
          <p className="format-arquivo-atual">
            {documento ? '✓ ' : ''}
            {nomeOriginal}
            {documento && (
              <button type="button" className="format-limpar" onClick={limpar}>
                Clear
              </button>
            )}
          </p>
        )}
      </section>

      {documento && (
        <>
          <section className="format-secao">
            <h2>2. Template</h2>
            <div className="format-templates">
              {opcoes.map((t) => (
                <div key={t.id} className={`format-template-card${selecionadoId === t.id ? ' selecionada' : ''}`}>
                  <label className="format-template-opcao">
                    <input type="radio" name="template" checked={selecionadoId === t.id} onChange={() => setSelecionadoId(t.id)} />
                    <span className="format-template-nome">{t.nome}</span>
                    <span className="format-template-descricao">{t.descricao}</span>
                  </label>
                  {t.id === 'custom' && (
                    <div className="format-template-custom-acoes">
                      <label className="format-upload-mini-label">
                        <input type="file" accept=".docx" hidden onChange={(e) => void substituirTemplate(e)} />
                        <span className="format-upload-mini-botao">{substituindo ? 'Reading…' : 'Replace with another .docx…'}</span>
                      </label>
                      {temTemplateCustomizado && (
                        <button type="button" className="format-link-botao" onClick={() => void resetarTemplate()} disabled={carregandoPadrao}>
                          Reset to default
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {carregandoPadrao && <p className="format-template-status">Loading default template…</p>}
            {erroTemplate && <p className="format-erro">{erroTemplate}</p>}
          </section>

          <section className="format-secao">
            <h2>3. Preview</h2>
            <div className="format-preview" style={{ fontFamily: template.fonte }}>
              <h1 style={{ color: template.corDestaque, fontSize: template.tamanhosPt.titulo }}>{documento.titulo}</h1>
              {agruparParaPreview(documento.blocos).map((item, i) => {
                if (item.tipo === 'lista') {
                  return (
                    <ul key={i} style={{ fontSize: template.tamanhosPt['item-lista'] }}>
                      {item.itens.map((texto, j) => (
                        <li key={j}>{texto}</li>
                      ))}
                    </ul>
                  );
                }
                if (item.tipo === 'h1' || item.tipo === 'h2' || item.tipo === 'h3') {
                  const Tag = item.tipo;
                  return (
                    <Tag key={i} style={{ color: template.corDestaque, fontSize: template.tamanhosPt[item.tipo] }}>
                      {item.texto}
                    </Tag>
                  );
                }
                if (item.tipo === 'citacao') {
                  return (
                    <blockquote key={i} style={{ fontSize: template.tamanhosPt.citacao, borderLeft: `3px solid ${template.corDestaque}` }}>
                      {item.texto}
                    </blockquote>
                  );
                }
                return (
                  <p key={i} style={{ fontSize: template.tamanhosPt.paragrafo, marginBottom: template.espacamentoParagraphoPt }}>
                    {item.texto}
                  </p>
                );
              })}
            </div>
          </section>

          <section className="format-secao">
            <h2>4. Download</h2>
            <div className="format-downloads">
              {(Object.keys(ROTULO_FORMATO) as FormatoSaida[]).map((formato) => (
                <button key={formato} type="button" onClick={() => void baixar(formato, template)} disabled={baixandoFormato !== null}>
                  {baixandoFormato === formato ? 'Generating…' : ROTULO_FORMATO[formato]}
                </button>
              ))}
            </div>
          </section>
        </>
      )}

      {erro && <p className="format-erro">{erro}</p>}
    </div>
  );
}
