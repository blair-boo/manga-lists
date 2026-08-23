import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './parseMarkdown';
import { documentoParaMarkdown } from './exportarMarkdown';

describe('parseMarkdown', () => {
  it('usa o primeiro h1 como título e remove ele dos blocos', () => {
    const doc = parseMarkdown('# My Book\n\nSome intro text.\n', 'fallback');
    expect(doc.titulo).toBe('My Book');
    expect(doc.blocos).toEqual([{ tipo: 'paragrafo', texto: 'Some intro text.' }]);
  });

  it('cai pro nome do arquivo quando não há h1', () => {
    const doc = parseMarkdown('Just text, no heading.', 'my-file');
    expect(doc.titulo).toBe('my-file');
  });

  it('reconhece h2/h3, citação e itens de lista', () => {
    const md = ['## Section', '', '> A quote', '', '- item one', '- item two', '', 'A paragraph.'].join('\n');
    const doc = parseMarkdown(md, 'doc');
    expect(doc.blocos).toEqual([
      { tipo: 'h2', texto: 'Section' },
      { tipo: 'citacao', texto: 'A quote' },
      { tipo: 'item-lista', texto: 'item one' },
      { tipo: 'item-lista', texto: 'item two' },
      { tipo: 'paragrafo', texto: 'A paragraph.' },
    ]);
  });

  it('junta linhas consecutivas de um mesmo parágrafo', () => {
    const doc = parseMarkdown('Line one\nLine two continues.\n\nNew paragraph.', 'doc');
    expect(doc.blocos).toEqual([
      { tipo: 'paragrafo', texto: 'Line one Line two continues.' },
      { tipo: 'paragrafo', texto: 'New paragraph.' },
    ]);
  });
});

describe('documentoParaMarkdown', () => {
  it('serializa título, títulos e lista de volta pra markdown', () => {
    const doc = {
      titulo: 'My Book',
      blocos: [
        { tipo: 'h2' as const, texto: 'Section' },
        { tipo: 'item-lista' as const, texto: 'item one' },
        { tipo: 'item-lista' as const, texto: 'item two' },
        { tipo: 'paragrafo' as const, texto: 'A paragraph.' },
      ],
    };
    expect(documentoParaMarkdown(doc)).toBe(['# My Book', '', '## Section', '', '- item one', '- item two', '', 'A paragraph.', ''].join('\n'));
  });
});
