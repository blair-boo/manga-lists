import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '../db/localDb';
import { resumirReader, type ResumoReader } from '../lib/reader';
import type { Obra, ReaderCapitulo, ReaderFonte, ReaderObra } from '../types';

/** Uma linha da lista: o registro do Reader já casado com a obra e os derivados. */
export interface LinhaReader {
  reader: ReaderObra;
  obra: Obra | undefined;
  fontes: ReaderFonte[];
  capitulos: ReaderCapitulo[];
  resumo: ResumoReader;
}

/**
 * Carrega tudo do Reader do cache local e monta as linhas das duas listas.
 * Uma leitura só das três tabelas (em vez de uma por obra) porque o Dexie
 * devolve tudo em memória e o volume aqui é o de uma biblioteca pessoal — o
 * custo de filtrar em JS é menor que o de N consultas reativas.
 */
export function useReader(): { emAndamento: LinhaReader[]; concluidas: LinhaReader[]; carregando: boolean } {
  const readerObras = useLiveQuery(() => db.reader_obras.toArray(), []);
  const fontes = useLiveQuery(() => db.reader_fontes.toArray(), []);
  const capitulos = useLiveQuery(() => db.reader_capitulos.toArray(), []);
  const obras = useLiveQuery(() => db.obras.toArray(), []);

  return useMemo(() => {
    const carregando = !readerObras || !fontes || !capitulos || !obras;
    if (carregando) return { emAndamento: [], concluidas: [], carregando: true };

    const obraPorId = new Map(obras.map((o) => [o.id, o]));
    const fontesPorReader = agruparPor(fontes, (f) => f.reader_obra_id);
    const capitulosPorReader = agruparPor(capitulos, (c) => c.reader_obra_id);

    const linhas = readerObras
      .map<LinhaReader>((reader) => {
        const doReader = capitulosPorReader.get(reader.id) ?? [];
        return {
          reader,
          obra: obraPorId.get(reader.obra_id),
          fontes: fontesPorReader.get(reader.id) ?? [],
          capitulos: doReader,
          resumo: resumirReader(reader, doReader),
        };
      })
      .sort((a, b) => (a.obra?.titulo ?? '').localeCompare(b.obra?.titulo ?? ''));

    return {
      emAndamento: linhas.filter((l) => !l.reader.concluido),
      concluidas: linhas.filter((l) => l.reader.concluido),
      carregando: false,
    };
  }, [readerObras, fontes, capitulos, obras]);
}

function agruparPor<T>(itens: T[], chave: (item: T) => string): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const item of itens) {
    const k = chave(item);
    const atual = mapa.get(k);
    if (atual) atual.push(item);
    else mapa.set(k, [item]);
  }
  return mapa;
}

/** Ids das obras já inscritas no Reader — pra não oferecer duas vezes na busca. */
export function useObrasJaNoReader(): Set<string> {
  const readerObras = useLiveQuery(() => db.reader_obras.toArray(), []);
  return useMemo(() => new Set((readerObras ?? []).map((r) => r.obra_id)), [readerObras]);
}
