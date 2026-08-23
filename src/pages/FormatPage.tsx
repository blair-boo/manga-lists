import { TEMPLATES, buscarTemplate } from '../lib/formatador/templates';
import type { Bloco } from '../lib/formatador/tipos';
import { useFormatador, type FormatoSaida } from '../lib/useFormatador';

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
 * lib/formatador/tipos.ts), aplica um dos templates de formatação e permite
 * baixar o resultado nos 4 formatos (md/docx/pdf/epub).
 */
export function FormatPage() {
  const { nomeOriginal, documento, templateId, setTemplateId, processando, erro, baixandoFormato, handleArquivoSelecionado, limpar, baixar } =
    useFormatador();

  const template = buscarTemplate(templateId);

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
              {TEMPLATES.map((t) => (
                <label key={t.id} className={`format-template-opcao${templateId === t.id ? ' selecionada' : ''}`}>
                  <input type="radio" name="template" checked={templateId === t.id} onChange={() => setTemplateId(t.id)} />
                  <span className="format-template-nome">{t.nome}</span>
                  <span className="format-template-descricao">{t.descricao}</span>
                </label>
              ))}
            </div>
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
                <button key={formato} type="button" onClick={() => void baixar(formato)} disabled={baixandoFormato !== null}>
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
