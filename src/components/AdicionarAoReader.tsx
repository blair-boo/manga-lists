import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useState } from 'react';
import { db } from '../db/localDb';
import { criarReaderFonte, criarReaderObra, readerObraPadrao } from '../db/repo';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useObrasJaNoReader } from '../hooks/useReader';
import { useToast } from './Toast';
import { VinculoObraSelect } from './VinculoObraSelect';
import type { Obra } from '../types';

/**
 * Inscreve uma Novel já cadastrada no Reader, junto com a primeira fonte.
 *
 * As `fontes` que a obra já tem aparecem como sugestão clicável, mas nunca são
 * herdadas sozinhas: de onde baixar é escolha sua, e uma fonte cadastrada pra
 * acompanhar lançamento não é necessariamente de onde você quer o texto.
 */
export function AdicionarAoReader() {
  const [obraId, setObraId] = useState('');
  const [grupo, setGrupo] = useState('');
  const [url, setUrl] = useState('');
  const { mostrarToast } = useToast();
  const jaNoReader = useObrasJaNoReader();

  const novels = useLiveQuery(async () => {
    const todas = await db.obras.toArray();
    return todas.filter((o) => o.tipo === 'Novel');
  }, []);

  const sugestoes = useLiveQuery(
    async () => (obraId ? await db.fontes.where('obra_id').equals(obraId).toArray() : []),
    [obraId]
  );

  const adicionar = useAsyncAction(async () => {
    if (!obraId) return;
    const temFonte = Boolean(grupo.trim() || url.trim());
    // Só adia o sync quando ainda vem uma fonte logo atrás — sem fonte, é esta
    // chamada que precisa disparar, senão a inscrição fica esperando o ciclo
    // periódico pra subir.
    const readerObra = await criarReaderObra(readerObraPadrao(obraId), !temFonte);
    if (temFonte) {
      await criarReaderFonte({
        reader_obra_id: readerObra.id,
        grupo: grupo.trim() || 'Unnamed group',
        url_indice: url.trim() || null,
        url_base: null,
        de: 1,
        ate: null,
        adaptador: null,
        preferida: true,
        ordem: 0,
        ativa: true,
      });
    }
    setObraId('');
    setGrupo('');
    setUrl('');
    mostrarToast('Added to the Reader');
  });

  const jaInscrita = obraId !== '' && jaNoReader.has(obraId);
  const elegiveis = (novels ?? []).filter((o) => !jaNoReader.has(o.id));
  // Estável entre renders: o VinculoObraSelect usa o predicado como dep do memo
  // de sugestões, e uma função nova a cada render o recalcularia à toa.
  const soNovelsElegiveis = useCallback(
    (obra: Obra) => obra.tipo === 'Novel' && !jaNoReader.has(obra.id),
    [jaNoReader]
  );

  return (
    <section className="atualizacao-secao reader-adicionar">
      <h2>Add a novel to the Reader</h2>
      {elegiveis.length === 0 && novels !== undefined && (
        <p className="reader-dica">
          Every work of type “Novel” is already in the Reader. Register a new one on the Add tab first.
        </p>
      )}
      <div className="reader-adicionar-campos">
        <VinculoObraSelect
          value={obraId}
          onChange={setObraId}
          filtrar={soNovelsElegiveis}
          placeholder="Search a novel…"
        />
        <input value={grupo} onChange={(e) => setGrupo(e.target.value)} placeholder="Group name" aria-label="Group name" />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Chapter list URL"
          aria-label="Chapter list URL"
        />
        <button type="button" onClick={() => void adicionar.executar()} disabled={!obraId || jaInscrita || adicionar.executando}>
          Add
        </button>
      </div>

      {jaInscrita && <p className="reader-dica">This work is already in the Reader.</p>}

      {obraId && (sugestoes ?? []).length > 0 && (
        <div className="reader-sugestoes">
          <span className="reader-rotulo">Sources already registered for this work</span>
          <ul>
            {(sugestoes ?? []).map((f) => (
              <li key={f.id}>
                <button type="button" className="reader-sugestao" onClick={() => setUrl(f.url)}>
                  {f.site ?? f.url}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {adicionar.erro && <p className="reader-erro">{adicionar.erro}</p>}
    </section>
  );
}
