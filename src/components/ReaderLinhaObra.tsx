import { Link } from 'react-router-dom';
import { updateReaderObra } from '../db/repo';
import { AVISO_SEM_DOWNLOADER, fontePreferida, rotuloCapitulo } from '../lib/reader';
import { useAsyncAction } from '../hooks/useAsyncAction';
import type { LinhaReader } from '../hooks/useReader';
import { IconeLivro } from './Icones';
import { ReaderEstadoBadge } from './ReaderEstadoBadge';
import { ReaderProximosCapitulos } from './ReaderProximosCapitulos';

interface Props {
  linha: LinhaReader;
  variante: 'andamento' | 'concluida';
  onAbrirPreview: (linha: LinhaReader) => void;
}

export function ReaderLinhaObra({ linha, variante, onAbrirPreview }: Props) {
  const { reader, obra, fontes, resumo } = linha;
  const fonte = fontePreferida(fontes);

  const alternarBusca = useAsyncAction(async () => {
    await updateReaderObra(reader.id, { busca_manual: !reader.busca_manual });
  });

  const titulo = reader.info_titulo ?? obra?.titulo ?? '(work not found)';

  return (
    <li className={`reader-linha reader-linha-${variante}`}>
      <div className="reader-linha-topo">
        <span className="reader-titulo">{titulo}</span>
        <div className="reader-acoes-icones">
          {obra && (
            <Link to={`/obra/${obra.id}`} className="btn-icone" title="Open in Ratsnest" aria-label="Open in Ratsnest">
              <IconeLivro />
            </Link>
          )}
          {/* Não reusa LinkExterno/LinkFonte: os dois embutem adicionar/remover
              contra colunas de `obras` ou a tabela `fontes`, e a URL daqui vive
              em reader_fontes. */}
          {fonte?.url_indice && (
            <a
              className="btn-icone"
              href={fonte.url_indice}
              target="_blank"
              rel="noreferrer"
              title={`Open on ${fonte.grupo}`}
              aria-label={`Open on ${fonte.grupo}`}
            >
              ↗
            </a>
          )}
          <button type="button" className="btn-icone" onClick={() => onAbrirPreview(linha)} title="Preview">
            👁
          </button>
        </div>
      </div>

      {variante === 'andamento' ? (
        <div className="reader-linha-corpo">
          <div className="reader-campo">
            <span className="reader-rotulo">Status</span>
            <span>{obra?.status_publicacao ?? '—'}</span>
          </div>
          <div className="reader-campo">
            <span className="reader-rotulo">Chapters</span>
            <span>
              {resumo.baixados}/{resumo.total}
              {resumo.sideStories > 0 && <span className="reader-ss"> + {resumo.sideStories} SS</span>}
            </span>
          </div>
          <div className="reader-campo">
            <span className="reader-rotulo">Last downloaded</span>
            <span>{resumo.ultimoBaixado ? rotuloCapitulo(resumo.ultimoBaixado) : '—'}</span>
          </div>
          <div className="reader-campo reader-campo-largo">
            <span className="reader-rotulo">State</span>
            <ReaderEstadoBadge estado={resumo.estado} estadoEm={resumo.estadoEm} reader={reader} />
          </div>
          <div className="reader-campo reader-campo-largo">
            <span className="reader-rotulo">Next chapters available</span>
            <ReaderProximosCapitulos capitulos={resumo.proximosDisponiveis} />
          </div>
          <div className="reader-campo reader-campo-largo">
            <span className="reader-rotulo">Actions</span>
            <div className="reader-botoes">
              <button
                type="button"
                className={reader.busca_manual ? 'reader-toggle reader-toggle-on' : 'reader-toggle'}
                onClick={() => void alternarBusca.executar()}
                disabled={alternarBusca.executando}
                aria-pressed={reader.busca_manual}
                title="Flags this work for the next scan. No scan is scheduled yet."
              >
                {reader.busca_manual ? 'Search queued' : 'Search now'}
              </button>
              <button type="button" disabled title={AVISO_SEM_DOWNLOADER}>
                Download pending ({resumo.aguardandoDecisao.length})
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="reader-linha-corpo">
          <div className="reader-campo">
            <span className="reader-rotulo">Chapters</span>
            <span>
              {resumo.baixados}
              {resumo.sideStories > 0 && <span className="reader-ss"> + {resumo.sideStories} SS</span>}
            </span>
          </div>
          <div className="reader-campo reader-campo-largo">
            <span className="reader-rotulo">Files</span>
            <div className="reader-botoes">
              <BotaoArtefato rotulo="EPUB" path={reader.epub_path} />
              <BotaoArtefato rotulo="PDF" path={reader.pdf_path} />
              <button type="button" disabled title={AVISO_SEM_DOWNLOADER}>
                Send to Kindle
              </button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * "Open X" quando o arquivo já existe, "Generate X" quando não. O caminho de
 * abrir também está desabilitado por enquanto: o bucket é privado, e a URL
 * assinada que o preview vai usar só chega com o builder.
 */
function BotaoArtefato({ rotulo, path }: { rotulo: string; path: string | null }) {
  return (
    <button type="button" disabled title={AVISO_SEM_DOWNLOADER}>
      {path ? `Open ${rotulo}` : `Generate ${rotulo}`}
    </button>
  );
}
