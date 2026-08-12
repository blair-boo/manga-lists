import { describe, expect, it } from 'vitest';
import type { LinhaArquivoImagens } from './imagensArquivo';
import {
  detectarColisoesNaLista,
  itensDeLinhasArquivo,
  itensDeLinksColados,
  mesclarItens,
  resolverColisaoNome,
} from './imagensLista';
import type { ItemImagem } from './imagensTipos';

function item(sobrescritas: Partial<ItemImagem> & { id: string; url: string; nome: string }): ItemImagem {
  return { origem: 'colado', status: 'pendente', tentativas: 0, ...sobrescritas };
}

describe('itensDeLinksColados', () => {
  it('gera um item por link válido, com nome derivado da URL', () => {
    const { itens, invalidos } = itensDeLinksColados('https://a.com/x.jpg;https://b.com/y.jpg');
    expect(itens).toHaveLength(2);
    expect(itens[0]).toMatchObject({ url: 'https://a.com/x.jpg', nome: 'x.jpg', origem: 'colado', status: 'pendente' });
    expect(itens[1]).toMatchObject({ url: 'https://b.com/y.jpg', nome: 'y.jpg' });
    expect(invalidos).toBe(0);
  });

  it('conta links inválidos sem incluí-los na lista', () => {
    const { itens, invalidos } = itensDeLinksColados('https://a.com/x.jpg;nao-e-url;http://sem-https.com/y.jpg');
    expect(itens).toHaveLength(1);
    expect(invalidos).toBe(2);
  });
});

describe('itensDeLinhasArquivo', () => {
  it('usa o nome da linha quando presente', () => {
    const linhas: LinhaArquivoImagens[] = [{ link: 'https://a.com/x.jpg', nome: 'Capa X' }];
    const { itens } = itensDeLinhasArquivo(linhas);
    expect(itens[0]).toMatchObject({ url: 'https://a.com/x.jpg', nome: 'Capa X', origem: 'arquivo' });
  });

  it('nome em branco na linha cai pro nome derivado da URL', () => {
    const linhas: LinhaArquivoImagens[] = [{ link: 'https://a.com/x.jpg', nome: '' }];
    const { itens } = itensDeLinhasArquivo(linhas);
    expect(itens[0].nome).toBe('x.jpg');
  });

  it('link inválido é contado e não vira item', () => {
    const linhas: LinhaArquivoImagens[] = [{ link: 'nao-e-url', nome: 'Capa X' }];
    const { itens, invalidos } = itensDeLinhasArquivo(linhas);
    expect(itens).toHaveLength(0);
    expect(invalidos).toBe(1);
  });
});

describe('mesclarItens', () => {
  it('descarta itens novos cuja URL já está na lista atual', () => {
    const atual = [item({ id: '1', url: 'https://a.com/x.jpg', nome: 'x.jpg' })];
    const novos = [
      item({ id: '2', url: 'https://a.com/x.jpg', nome: 'x-de-novo.jpg' }),
      item({ id: '3', url: 'https://b.com/y.jpg', nome: 'y.jpg' }),
    ];
    const { itens, duplicados } = mesclarItens(atual, novos);
    expect(itens.map((i) => i.url)).toEqual(['https://a.com/x.jpg', 'https://b.com/y.jpg']);
    expect(duplicados).toBe(1);
  });
});

describe('detectarColisoesNaLista', () => {
  it('marca ids cujo nome final se repete em mais de um item', () => {
    const itens = [
      item({ id: '1', url: 'https://a.com/x.jpg', nome: 'capa.jpg' }),
      item({ id: '2', url: 'https://b.com/y.jpg', nome: 'capa.jpg' }),
      item({ id: '3', url: 'https://c.com/z.jpg', nome: 'outra.jpg' }),
    ];
    expect(detectarColisoesNaLista(itens)).toEqual(new Set(['1', '2']));
  });

  it('lista sem nomes repetidos não marca nada', () => {
    const itens = [
      item({ id: '1', url: 'https://a.com/x.jpg', nome: 'a.jpg' }),
      item({ id: '2', url: 'https://b.com/y.jpg', nome: 'b.jpg' }),
    ];
    expect(detectarColisoesNaLista(itens).size).toBe(0);
  });
});

describe('resolverColisaoNome', () => {
  it('nome livre volta sem alteração', () => {
    expect(resolverColisaoNome('capa.jpg', new Set(['outra.jpg']))).toBe('capa.jpg');
  });

  it('nome ocupado ganha sufixo -2, preservando a extensão', () => {
    expect(resolverColisaoNome('capa.jpg', new Set(['capa.jpg']))).toBe('capa-2.jpg');
  });

  it('incrementa o sufixo até achar um nome livre', () => {
    expect(resolverColisaoNome('capa.jpg', new Set(['capa.jpg', 'capa-2.jpg', 'capa-3.jpg']))).toBe('capa-4.jpg');
  });
});
