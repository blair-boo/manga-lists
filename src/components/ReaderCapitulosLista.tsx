import { useState } from 'react';
import { criarReaderCapitulo, deleteReaderCapitulo, updateReaderCapitulo } from '../db/repo';
import {
  AVISO_SEM_DOWNLOADER,
  chaveCapitulo,
  formatarData,
  ordenarCapitulosReader,
  paywallLiberado,
  rotuloCapitulo,
} from '../lib/reader';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useDialogos } from './Dialogo';
import type { ReaderCapitulo, ReaderEstadoCapitulo } from '../types';

const ESTADOS: ReaderEstadoCapitulo[] = ['descoberto', 'bloqueado', 'baixado', 'formatado', 'publicado'];

interface Props {
  readerObraId: string;
  obraId: string;
  capitulos: ReaderCapitulo[];
  /** Concluídas não baixam mais nada — some com a seleção e o cadastro manual. */
  somenteLeitura: boolean;
}

/**
 * Lista de capítulos do preview. Os capítulos em si não abrem aqui: o que
 * interessa é o estado de cada um e quais você quer baixar.
 *
 * O cadastro manual existe porque, sem varredura ainda, é o único jeito de
 * exercitar o pipeline inteiro — e continua útil depois, pra recuperar um
 * capítulo que o site publicou fora da lista.
 */
export function ReaderCapitulosLista({ readerObraId, obraId, capitulos, somenteLeitura }: Props) {
  const ordenados = ordenarCapitulosReader(capitulos);
  const { confirmar } = useDialogos();
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [novoNumero, setNovoNumero] = useState('');
  const [novoTitulo, setNovoTitulo] = useState('');
  const [novoSide, setNovoSide] = useState(false);

  const agora = new Date();

  function alternar(id: string) {
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  const adicionar = useAsyncAction(async () => {
    const numero = novoNumero.trim() ? Number(novoNumero) : null;
    // `ordem` é o eixo real de ordenação; sem varredura, derivamos do número
    // informado e caímos no fim da lista quando não há número.
    const ordem = numero ?? (ordenados.at(-1)?.ordem ?? 0) + 1;
    // Mesma chave que a varredura vai derivar, pra que um capítulo cadastrado
    // à mão seja reconhecido (e atualizado) quando o scraper passar por ele.
    const chave = chaveCapitulo(numero, novoSide, novoTitulo.trim() || null);
    if (!chave) throw new Error('Informe o número do capítulo ou um título.');
    await criarReaderCapitulo({
      reader_obra_id: readerObraId,
      obra_id: obraId,
      reader_fonte_id: null,
      chave,
      id_externo: null,
      numero,
      numero_texto: null,
      titulo: novoTitulo.trim() || null,
      side_story: novoSide,
      ordem,
      estado: 'descoberto',
      estado_em: new Date().toISOString(),
      disponivel_em: null,
      url: null,
      path_md: null,
      baixado_em: null,
      formatado_em: null,
      erro: null,
      erro_em: null,
    });
    setNovoNumero('');
    setNovoTitulo('');
    setNovoSide(false);
  });

  const remover = useAsyncAction(async (id: string) => {
    const ok = await confirmar({
      titulo: 'Remove chapter',
      mensagem: 'Remove this chapter from the Reader?',
      confirmarRotulo: 'Remove',
      perigoso: true,
    });
    if (ok) await deleteReaderCapitulo(id);
  });

  if (ordenados.length === 0 && somenteLeitura) {
    return <p className="reader-vazio">No chapters yet.</p>;
  }

  return (
    <div className="reader-capitulos">
      {!somenteLeitura && (
        <div className="reader-capitulos-barra">
          <span>{selecionados.size} selected</span>
          <button type="button" disabled title={AVISO_SEM_DOWNLOADER}>
            Download selected
          </button>
        </div>
      )}

      <ul className="reader-capitulos-lista">
        {ordenados.map((c) => {
          const liberado = paywallLiberado(c, agora);
          return (
            <li key={c.id} className={`reader-capitulo reader-capitulo-${c.estado}`}>
              {!somenteLeitura && (
                <input
                  type="checkbox"
                  checked={selecionados.has(c.id)}
                  onChange={() => alternar(c.id)}
                  aria-label={`Select ${rotuloCapitulo(c)}`}
                />
              )}
              <span className="reader-capitulo-num">{rotuloCapitulo(c)}</span>
              <span className="reader-capitulo-titulo">{c.titulo ?? ''}</span>
              {c.side_story && <span className="badge reader-badge-ss">Side story</span>}
              <select
                className="reader-capitulo-estado"
                value={c.estado}
                onChange={(e) => void updateReaderCapitulo(c.id, { estado: e.target.value as ReaderEstadoCapitulo })}
                aria-label="Chapter state"
                disabled={somenteLeitura}
              >
                {ESTADOS.map((estado) => (
                  <option key={estado} value={estado}>
                    {estado}
                  </option>
                ))}
              </select>
              {c.disponivel_em && (
                <span className={liberado ? 'reader-capitulo-liberado' : 'reader-capitulo-preso'}>
                  {liberado ? 'unlocked' : `unlocks ${formatarData(c.disponivel_em)}`}
                </span>
              )}
              {!somenteLeitura && (
                <button type="button" className="btn-icone" onClick={() => void remover.executar(c.id)} title="Remove">
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {!somenteLeitura && (
        <div className="reader-capitulos-novo">
          <input
            className="reader-fonte-faixa"
            type="number"
            step="0.5"
            value={novoNumero}
            onChange={(e) => setNovoNumero(e.target.value)}
            placeholder="no."
            aria-label="Chapter number"
          />
          <input
            value={novoTitulo}
            onChange={(e) => setNovoTitulo(e.target.value)}
            placeholder="Chapter title (optional)"
            aria-label="Chapter title"
          />
          <label className="reader-checkbox">
            <input type="checkbox" checked={novoSide} onChange={(e) => setNovoSide(e.target.checked)} />
            Side story
          </label>
          <button type="button" onClick={() => void adicionar.executar()} disabled={adicionar.executando}>
            Add chapter
          </button>
        </div>
      )}
      {adicionar.erro && <p className="reader-erro">{adicionar.erro}</p>}
    </div>
  );
}
