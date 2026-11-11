import { describe, expect, it } from 'vitest';
import {
  codificarPayload,
  decodificarPayload,
  ehTituloLatino,
  extrairDetalheDoHtml,
  normalizarComix,
  validarUrlComix,
} from './comix';
import detalheFixture from './__fixtures__/comix-detalhe.json';

describe('normalizarComix', () => {
  it('mapeia manhwa -> Manhwa e finished -> Completed', () => {
    const obra = normalizarComix(detalheFixture);
    expect(obra.tipo).toBe('Manhwa');
    expect(obra.statusPublicacao).toBe('Completed');
  });

  it('tipo ou status desconhecido vira null sem lançar, preservando o valor bruto', () => {
    const obra = normalizarComix({ ...detalheFixture, type: 'webtoon', status: 'not_yet_released' });
    expect(obra.tipo).toBeNull();
    expect(obra.statusPublicacao).toBeNull();
    expect(obra.tipoBruto).toBe('webtoon');
    expect(obra.statusPublicacaoBruto).toBe('not_yet_released');
  });

  it('latestChapter: 0 vira null', () => {
    const obra = normalizarComix({ ...detalheFixture, latestChapter: 0 });
    expect(obra.ultimoCapitulo).toBeNull();
  });

  it('latestChapter ausente também vira null', () => {
    const { latestChapter: _latestChapter, ...semCapitulo } = detalheFixture;
    const obra = normalizarComix(semCapitulo);
    expect(obra.ultimoCapitulo).toBeNull();
  });

  it('título alternativo igual ao principal é removido', () => {
    const obra = normalizarComix({ ...detalheFixture, altTitles: [detalheFixture.title, 'The Villain\'s Death'] });
    expect(obra.titulosAlternativos).toEqual(["The Villain's Death"]);
  });

  it('links ausente devolve os cinco campos null', () => {
    const { links: _links, ...semLinks } = detalheFixture;
    const obra = normalizarComix(semLinks);
    expect(obra.links).toEqual({
      anilist_url: null,
      myanimelist_url: null,
      mangaupdates_url: null,
      mangadex_url: null,
      mangabaka_url: null,
    });
  });

  it('links parcial: chave ausente vira null, as demais mantêm o valor', () => {
    const obra = normalizarComix({ ...detalheFixture, links: { al: detalheFixture.links.al } });
    expect(obra.links.anilist_url).toBe(detalheFixture.links.al);
    expect(obra.links.myanimelist_url).toBeNull();
  });

  it('extrai autor/artista preservando nome nativo entre parênteses', () => {
    const obra = normalizarComix(detalheFixture);
    expect(obra.autores).toEqual(['Gwon Gyeoeul (권겨을)']);
    expect(obra.artistas).toEqual(['SUOL (수월)']);
  });

  it('url relativa vira absoluta prefixada por BASE_COMIX', () => {
    const obra = normalizarComix(detalheFixture);
    expect(obra.url).toBe('https://comix.to/title/x0ynk-villains-are-destined-to-die');
  });

  it('hid, title ou url ausente lança erro', () => {
    expect(() => normalizarComix({ ...detalheFixture, hid: undefined })).toThrow('Unexpected comix.to page format');
    expect(() => normalizarComix({ ...detalheFixture, title: undefined })).toThrow('Unexpected comix.to page format');
    expect(() => normalizarComix({ ...detalheFixture, url: undefined })).toThrow('Unexpected comix.to page format');
  });
});

describe('ehTituloLatino', () => {
  it('true para escrita latina, false para coreano/japonês/chinês', () => {
    expect(ehTituloLatino('The Villain\'s Death')).toBe(true);
    expect(ehTituloLatino('빌런의 죽음')).toBe(false);
    expect(ehTituloLatino('俺だけレベルアップな件')).toBe(false);
  });
});

describe('codificarPayload / decodificarPayload', () => {
  it('round-trip preserva o objeto original, com título contendo caracteres coreanos', () => {
    const obra = normalizarComix(detalheFixture);
    const codificado = codificarPayload(obra);
    expect(decodificarPayload(codificado)).toEqual(obra);
    expect(obra.artistas[0]).toContain('수월');
  });

  it('payload inválido lança erro legível', () => {
    expect(() => decodificarPayload('###não é base64###')).toThrow('Invalid comix.to payload');
  });
});

describe('validarUrlComix', () => {
  it('rejeita host que não seja comix.to', () => {
    expect(validarUrlComix('https://evil.com/title/x')).toBeNull();
  });

  it('aceita comix.to e www.comix.to', () => {
    expect(validarUrlComix('https://comix.to/title/x0ynk-villains-are-destined-to-die')).toBe(
      'https://comix.to/title/x0ynk-villains-are-destined-to-die'
    );
    expect(validarUrlComix('https://www.comix.to/title/x0ynk-villains-are-destined-to-die')).toBe(
      'https://www.comix.to/title/x0ynk-villains-are-destined-to-die'
    );
  });

  it('rejeita URL fora do path /title/', () => {
    expect(validarUrlComix('https://comix.to/browse')).toBeNull();
  });
});

describe('extrairDetalheDoHtml', () => {
  it('extrai o objeto de detalhe do bloco #initial-data', () => {
    const html = `<html><body><script type="application/json" id="initial-data">${JSON.stringify({
      manga: { hid: 'x0ynk' },
      queries: { '["manga","detail","x0ynk"]': detalheFixture },
    })}</script></body></html>`;
    expect(extrairDetalheDoHtml(html)).toEqual(detalheFixture);
  });

  it('HTML sem o script lança erro legível', () => {
    expect(() => extrairDetalheDoHtml('<html><body>nada aqui</body></html>')).toThrow(
      'Unexpected comix.to page format'
    );
  });
});
