import { describe, expect, it } from 'vitest';
import { detectarTipoArquivoImagens, parseArquivoImagens } from './imagensArquivo';

function csvFile(texto: string, nome = 'links.csv'): File {
  return new File([texto], nome, { type: 'text/csv' });
}

describe('detectarTipoArquivoImagens', () => {
  it('detecta CSV pela extensão', () => {
    expect(detectarTipoArquivoImagens(new File([''], 'links.csv'))).toBe('csv');
  });

  it('detecta XLSX pela extensão', () => {
    expect(detectarTipoArquivoImagens(new File([''], 'links.xlsx'))).toBe('xlsx');
  });

  it('extensão desconhecida devolve null', () => {
    expect(detectarTipoArquivoImagens(new File([''], 'links.txt'))).toBeNull();
  });
});

describe('parseArquivoImagens (CSV)', () => {
  it('casa cabeçalho "link"/"nome" sem diferenciar maiúsculas', async () => {
    const resultado = await parseArquivoImagens(
      csvFile('Link,Nome\nhttps://a.com/x.jpg,Capa X\nhttps://b.com/y.jpg,Capa Y\n')
    );
    expect(resultado.linhas).toEqual([
      { link: 'https://a.com/x.jpg', nome: 'Capa X' },
      { link: 'https://b.com/y.jpg', nome: 'Capa Y' },
    ]);
    expect(resultado.linhasComProblema).toBe(0);
  });

  it('casa cabeçalho "image link"/"name to save the image as"', async () => {
    const resultado = await parseArquivoImagens(
      csvFile('image link,name to save the image as\nhttps://a.com/x.jpg,capa-x\n')
    );
    expect(resultado.linhas).toEqual([{ link: 'https://a.com/x.jpg', nome: 'capa-x' }]);
  });

  it('sem cabeçalho reconhecido cai no fallback posicional (coluna 1 = link, coluna 2 = nome)', async () => {
    const resultado = await parseArquivoImagens(csvFile('https://a.com/x.jpg,Capa X\nhttps://b.com/y.jpg,Capa Y\n'));
    expect(resultado.linhas).toEqual([
      { link: 'https://a.com/x.jpg', nome: 'Capa X' },
      { link: 'https://b.com/y.jpg', nome: 'Capa Y' },
    ]);
  });

  it('nome em branco é aceito (nome final é derivado da URL depois, não aqui)', async () => {
    const resultado = await parseArquivoImagens(csvFile('link,nome\nhttps://a.com/x.jpg,\n'));
    expect(resultado.linhas).toEqual([{ link: 'https://a.com/x.jpg', nome: '' }]);
    expect(resultado.linhasComProblema).toBe(0);
  });

  it('linha sem link é descartada e contada em linhasComProblema', async () => {
    const resultado = await parseArquivoImagens(csvFile('link,nome\n,Sem link\nhttps://a.com/x.jpg,Capa X\n'));
    expect(resultado.linhas).toEqual([{ link: 'https://a.com/x.jpg', nome: 'Capa X' }]);
    expect(resultado.linhasComProblema).toBe(1);
  });
});

describe('parseArquivoImagens (XLSX)', () => {
  it('lê a primeira aba com o mesmo casamento de cabeçalho do CSV', async () => {
    const XLSX = await import('xlsx');
    const planilha = XLSX.utils.aoa_to_sheet([
      ['link', 'nome'],
      ['https://a.com/x.jpg', 'Capa X'],
      ['https://b.com/y.jpg', 'Capa Y'],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, planilha, 'Sheet1');
    // type: 'array' devolve um ArrayBuffer de verdade (em vez do Buffer do
    // Node de type: 'buffer', cujo .buffer é tipado ArrayBufferLike — não
    // bate com BlobPart do construtor File).
    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const file = new File([buffer], 'links.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const resultado = await parseArquivoImagens(file);
    expect(resultado.linhas).toEqual([
      { link: 'https://a.com/x.jpg', nome: 'Capa X' },
      { link: 'https://b.com/y.jpg', nome: 'Capa Y' },
    ]);
  });
});
