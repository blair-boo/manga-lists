import { useState } from 'react';
import { criarReaderFonte, definirFontePreferida, deleteReaderFonte, updateReaderFonte } from '../db/repo';
import { ordenarFontesReader, textoTraducao } from '../lib/reader';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useDialogos } from './Dialogo';
import type { ReaderFonte } from '../types';

interface Props {
  readerObraId: string;
  fontes: ReaderFonte[];
}

/**
 * Grupos de tradução com suas faixas de capítulo. É a mesma tabela que serve de
 * origem de download, então editar aqui muda tanto o campo Translation da
 * página de informações quanto as opções da tela de download.
 *
 * Faixas sobrepostas são permitidas de propósito: quando dois grupos cobrem o
 * mesmo trecho, a escolha é sua — `preferida` só define o default.
 */
export function ReaderFontesEditor({ readerObraId, fontes }: Props) {
  const ordenadas = ordenarFontesReader(fontes);
  const { confirmar } = useDialogos();
  const [grupo, setGrupo] = useState('');
  const [url, setUrl] = useState('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');

  const adicionar = useAsyncAction(async () => {
    const nome = grupo.trim();
    if (!nome) return;
    await criarReaderFonte({
      reader_obra_id: readerObraId,
      grupo: nome,
      url_indice: url.trim() || null,
      url_base: null,
      de: de.trim() ? Number(de) : null,
      ate: ate.trim() ? Number(ate) : null,
      adaptador: null,
      // A primeira fonte cadastrada já entra como preferida — sem isso a obra
      // ficaria sem default e o ícone "ir para o site" não teria pra onde ir.
      preferida: fontes.length === 0,
      ordem: fontes.length,
      ativa: true,
    });
    setGrupo('');
    setUrl('');
    setDe('');
    setAte('');
  });

  const remover = useAsyncAction(async (id: string) => {
    const ok = await confirmar({
      titulo: 'Remove source',
      mensagem: 'Remove this translation group from the Reader?',
      confirmarRotulo: 'Remove',
      perigoso: true,
    });
    if (ok) await deleteReaderFonte(id);
  });

  return (
    <div className="reader-fontes">
      <p className="reader-traducao-preview">
        <span className="reader-rotulo">Translation</span>
        <span>{textoTraducao(fontes) || '—'}</span>
      </p>

      <ul className="reader-fontes-lista">
        {ordenadas.map((f) => (
          <li key={f.id} className={f.ativa ? '' : 'reader-fonte-inativa'}>
            <label className="reader-fonte-preferida">
              <input
                type="radio"
                name={`preferida-${readerObraId}`}
                checked={f.preferida}
                onChange={() => void definirFontePreferida(readerObraId, f.id)}
              />
              <span className="sr-only">Preferred source</span>
            </label>
            <input
              className="reader-fonte-grupo"
              value={f.grupo}
              onChange={(e) => void updateReaderFonte(f.id, { grupo: e.target.value })}
              aria-label="Group name"
            />
            <input
              className="reader-fonte-faixa"
              type="number"
              value={f.de ?? ''}
              placeholder="from"
              onChange={(e) => void updateReaderFonte(f.id, { de: e.target.value ? Number(e.target.value) : null })}
              aria-label="First chapter"
            />
            <input
              className="reader-fonte-faixa"
              type="number"
              value={f.ate ?? ''}
              placeholder="X"
              onChange={(e) => void updateReaderFonte(f.id, { ate: e.target.value ? Number(e.target.value) : null })}
              aria-label="Last chapter (empty = open ended)"
            />
            <input
              className="reader-fonte-url"
              value={f.url_indice ?? ''}
              placeholder="chapter list URL"
              onChange={(e) => void updateReaderFonte(f.id, { url_indice: e.target.value || null })}
              aria-label="Chapter list URL"
            />
            <button type="button" className="btn-icone" onClick={() => void remover.executar(f.id)} title="Remove">
              ×
            </button>
          </li>
        ))}
      </ul>

      <div className="reader-fontes-nova">
        <input value={grupo} onChange={(e) => setGrupo(e.target.value)} placeholder="Group name" aria-label="Group name" />
        <input
          className="reader-fonte-faixa"
          type="number"
          value={de}
          onChange={(e) => setDe(e.target.value)}
          placeholder="from"
          aria-label="First chapter"
        />
        <input
          className="reader-fonte-faixa"
          type="number"
          value={ate}
          onChange={(e) => setAte(e.target.value)}
          placeholder="X"
          aria-label="Last chapter (empty = open ended)"
        />
        <input
          className="reader-fonte-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="chapter list URL"
          aria-label="Chapter list URL"
        />
        <button type="button" onClick={() => void adicionar.executar()} disabled={!grupo.trim() || adicionar.executando}>
          Add source
        </button>
      </div>
      <p className="reader-dica">Leave the last chapter empty for an open-ended range (shown as “X”).</p>
      {adicionar.erro && <p className="reader-erro">{adicionar.erro}</p>}
    </div>
  );
}
