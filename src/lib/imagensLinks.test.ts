import { describe, expect, it } from 'vitest';
import {
  dividirLinks,
  garantirExtensao,
  nomeArquivoDaUrl,
  normalizarNomeArquivo,
  validarUrlImagem,
} from './imagensLinks';

describe('dividirLinks', () => {
  it('separa por ;', () => {
    expect(dividirLinks('https://a.com/x.jpg;https://b.com/y.jpg')).toEqual([
      'https://a.com/x.jpg',
      'https://b.com/y.jpg',
    ]);
  });

  it('separa por linha (Enter)', () => {
    expect(dividirLinks('https://a.com/x.jpg\nhttps://b.com/y.jpg')).toEqual([
      'https://a.com/x.jpg',
      'https://b.com/y.jpg',
    ]);
  });

  it('aceita os dois separadores misturados e ignora espaços/linhas em branco', () => {
    expect(dividirLinks(' https://a.com/x.jpg ;\nhttps://b.com/y.jpg\n\n; https://c.com/z.jpg')).toEqual([
      'https://a.com/x.jpg',
      'https://b.com/y.jpg',
      'https://c.com/z.jpg',
    ]);
  });

  it('texto vazio devolve lista vazia', () => {
    expect(dividirLinks('   \n ; ')).toEqual([]);
  });
});

describe('validarUrlImagem', () => {
  it('aceita https:// e devolve a URL canônica', () => {
    expect(validarUrlImagem('https://exemplo.com/capa.jpg')).toBe('https://exemplo.com/capa.jpg');
  });

  it('rejeita http:// (só https)', () => {
    expect(validarUrlImagem('http://exemplo.com/capa.jpg')).toBeNull();
  });

  it('rejeita texto que não é URL', () => {
    expect(validarUrlImagem('nem-url-nenhuma')).toBeNull();
  });
});

describe('nomeArquivoDaUrl', () => {
  it('deriva do último segmento do path', () => {
    expect(nomeArquivoDaUrl('https://exemplo.com/pasta/capa.jpg', 0)).toBe('capa.jpg');
  });

  it('decodifica caracteres percent-encoded', () => {
    expect(nomeArquivoDaUrl('https://exemplo.com/capa%20final.jpg', 0)).toBe('capa final.jpg');
  });

  it('cai pro fallback "imagem-N" quando não há segmento de path', () => {
    expect(nomeArquivoDaUrl('https://exemplo.com/', 2)).toBe('imagem-3');
  });
});

describe('normalizarNomeArquivo', () => {
  it('troca caracteres inválidos de nome de arquivo por hífen', () => {
    expect(normalizarNomeArquivo('capa/final:teste?.jpg')).toBe('capa-final-teste-.jpg');
  });

  it('colapsa espaços e corta nas bordas', () => {
    expect(normalizarNomeArquivo('  capa   final  ')).toBe('capa final');
  });

  it('nome vazio (ou só caracteres inválidos) cai pro fallback "imagem"', () => {
    expect(normalizarNomeArquivo('   ')).toBe('imagem');
  });
});

describe('garantirExtensao', () => {
  it('acrescenta a extensão certa quando o nome não tem uma extensão de imagem conhecida', () => {
    expect(garantirExtensao('capa', 'image/png')).toBe('capa.png');
  });

  it('não mexe no nome quando já termina com uma extensão de imagem conhecida', () => {
    expect(garantirExtensao('capa.jpeg', 'image/png')).toBe('capa.jpeg');
  });

  it('content-type desconhecido não altera o nome', () => {
    expect(garantirExtensao('capa', 'application/octet-stream')).toBe('capa');
  });
});
