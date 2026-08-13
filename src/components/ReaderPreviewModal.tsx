import { useState } from 'react';
import { updateReaderObra } from '../db/repo';
import { useAsyncAction } from '../hooks/useAsyncAction';
import type { LinhaReader } from '../hooks/useReader';
import { ModalBase } from './ModalBase';
import { ReaderCapitulosLista } from './ReaderCapitulosLista';
import { ReaderFontesEditor } from './ReaderFontesEditor';
import { ReaderInfoForm } from './ReaderInfoForm';

type Aba = 'capa' | 'info' | 'capitulos';

const ABAS: { id: Aba; rotulo: string }[] = [
  { id: 'capa', rotulo: 'Cover' },
  { id: 'info', rotulo: 'Information' },
  { id: 'capitulos', rotulo: 'Chapters' },
];

interface Props {
  linha: LinhaReader | null;
  onFechar: () => void;
}

/**
 * Preview dos três documentos que acompanham a obra: capa, página de
 * informações e lista de capítulos. Os capítulos em si não abrem aqui — o
 * documento é para ler no celular, não dentro do Ratsnest.
 */
export function ReaderPreviewModal({ linha, onFechar }: Props) {
  const [aba, setAba] = useState<Aba>('info');

  if (!linha) return null;
  const { reader, obra, fontes, capitulos } = linha;

  return (
    <ModalBase aberto rotulo="Reader preview" onFechar={onFechar} classe="reader-preview">
      <h2 className="reader-preview-titulo">{reader.info_titulo ?? obra?.titulo ?? 'Preview'}</h2>

      <nav className="reader-preview-abas">
        {ABAS.map((a) => (
          <button
            key={a.id}
            type="button"
            className={aba === a.id ? 'reader-aba reader-aba-ativa' : 'reader-aba'}
            onClick={() => setAba(a.id)}
            aria-pressed={aba === a.id}
          >
            {a.rotulo}
          </button>
        ))}
      </nav>

      {aba === 'capa' && <AbaCapa linha={linha} />}

      {aba === 'info' && (
        <>
          <ReaderInfoForm reader={reader} obra={obra} />
          <hr className="reader-separador" />
          <ReaderFontesEditor readerObraId={reader.id} fontes={fontes} />
        </>
      )}

      {aba === 'capitulos' && (
        <ReaderCapitulosLista
          readerObraId={reader.id}
          obraId={reader.obra_id}
          capitulos={capitulos}
          somenteLeitura={reader.concluido}
        />
      )}
    </ModalBase>
  );
}

/**
 * A capa do documento. Por ora reflete a capa do cadastro (bucket público
 * `capas`); a capa própria do Reader chega junto com o downloader, que é quem
 * vai baixá-la do site e guardar no bucket privado.
 */
function AbaCapa({ linha }: { linha: LinhaReader }) {
  const { reader, obra } = linha;
  const capa = obra?.capa_url ?? null;

  const alternarConcluido = useAsyncAction(async () => {
    await updateReaderObra(reader.id, { concluido: !reader.concluido });
  });

  return (
    <div className="reader-capa">
      {capa ? (
        <img src={capa} alt="" className="reader-capa-img" />
      ) : (
        <p className="reader-vazio">No cover yet. Add one on the work’s page in Ratsnest.</p>
      )}
      <p className="reader-dica">
        The Reader will download the work’s own cover from the source site once the downloader ships. For now this
        mirrors the cover registered in Ratsnest.
      </p>
      <button type="button" onClick={() => void alternarConcluido.executar()} disabled={alternarConcluido.executando}>
        {reader.concluido ? 'Move back to In progress' : 'Mark as completed'}
      </button>
      {alternarConcluido.erro && <p className="reader-erro">{alternarConcluido.erro}</p>}
    </div>
  );
}
