import { describe, expect, it } from 'vitest';
import { buscarTudoPaginado } from './paginacao';

/** Query falsa: devolve a fatia [from, to] (inclusiva, como o PostgREST). */
function queryFake(total: number, registro: [number, number][]) {
  const linhas = Array.from({ length: total }, (_, i) => ({ id: i }));
  return (from: number, to: number) => {
    registro.push([from, to]);
    return Promise.resolve({ data: linhas.slice(from, to + 1), error: null });
  };
}

describe('buscarTudoPaginado', () => {
  it('traz tudo quando passa de uma página', async () => {
    const registro: [number, number][] = [];
    const linhas = await buscarTudoPaginado(queryFake(1448, registro));
    expect(linhas).toHaveLength(1448);
    expect(registro).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    // Sem duplicatas nem buracos.
    expect(new Set(linhas.map((l) => l.id)).size).toBe(1448);
  });

  it('faz uma requisição só quando cabe numa página', async () => {
    const registro: [number, number][] = [];
    expect(await buscarTudoPaginado(queryFake(430, registro))).toHaveLength(430);
    expect(registro).toEqual([[0, 999]]);
  });

  it('busca uma página a mais quando o total é múltiplo exato', async () => {
    // A segunda página vem cheia, então só uma terceira (vazia) prova que
    // acabou. Parar em "veio cheia" perderia o resto quando não é múltiplo.
    const registro: [number, number][] = [];
    expect(await buscarTudoPaginado(queryFake(2000, registro))).toHaveLength(2000);
    expect(registro).toHaveLength(3);
  });

  it('devolve lista vazia numa tabela vazia', async () => {
    expect(await buscarTudoPaginado(queryFake(0, []))).toEqual([]);
  });

  it('propaga erro da query em vez de devolver resultado parcial', async () => {
    const linhas = Array.from({ length: 1500 }, (_, i) => ({ id: i }));
    const query = (from: number, to: number) =>
      from === 0
        ? Promise.resolve({ data: linhas.slice(from, to + 1), error: null })
        : Promise.resolve({ data: null, error: { message: 'boom' } });
    // Sem isso, um erro na 2ª página viraria "só 1000 linhas" em silêncio —
    // exatamente o bug que a paginação existe pra evitar.
    await expect(buscarTudoPaginado(query)).rejects.toEqual({ message: 'boom' });
  });
});
