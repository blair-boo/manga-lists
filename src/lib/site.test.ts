import { describe, expect, it } from 'vitest';
import { campoPorDominio, colunaCsvDaFonte, deriveSite, dominioDeUrl, tituloNoSite } from './site';

describe('dominioDeUrl', () => {
  it('extrai o host de uma URL válida', () => {
    expect(dominioDeUrl('https://magustoon.org/series/foo')).toBe('magustoon.org');
  });

  it('remove o prefixo www. e normaliza pra minúsculas', () => {
    expect(dominioDeUrl('https://WWW.CoolScans.NET/manga/bar')).toBe('coolscans.net');
  });

  it('retorna vazio para URL inválida ou relativa', () => {
    expect(dominioDeUrl('não é uma url')).toBe('');
    expect(dominioDeUrl('/series/foo')).toBe('');
    expect(dominioDeUrl('')).toBe('');
  });
});

describe('tituloNoSite', () => {
  it('deriva o título do slug com hífens e underscores', () => {
    expect(tituloNoSite('https://site.com/series/the-forgotten-field')).toBe('the forgotten field');
    expect(tituloNoSite('https://site.com/manga/solo_leveling')).toBe('solo leveling');
  });

  it('usa o último segmento do path e decodifica percent-encoding', () => {
    expect(tituloNoSite('https://site.com/a/b/rei-dos-mares/')).toBe('rei dos mares');
    expect(tituloNoSite('https://site.com/series/caf%C3%A9-com-leite')).toBe('café com leite');
  });

  it('aceita URL relativa (usa base sintética) e devolve vazio para path vazio', () => {
    expect(tituloNoSite('/series/some-title')).toBe('some title');
    expect(tituloNoSite('https://site.com/')).toBe('');
  });
});

describe('deriveSite', () => {
  it('mapeia domínios conhecidos pro slug do site', () => {
    expect(deriveSite('https://www.nyxscans.com/series/foo')).toBe('nyxscans');
    expect(deriveSite('https://ezmanga.org/series/bar')).toBe('ezmanga');
  });

  it('usa o host completo para domínios desconhecidos', () => {
    expect(deriveSite('https://coolscans.net/manga/baz')).toBe('coolscans.net');
  });

  it('retorna null para URL inválida', () => {
    expect(deriveSite('nope')).toBeNull();
  });
});

describe('campoPorDominio', () => {
  it('mapeia domínios de catálogo conhecidos pro campo dedicado da obra', () => {
    expect(campoPorDominio('https://www.novelupdates.com/series/foo')).toBe('novelupdates_url');
    expect(campoPorDominio('https://anilist.co/manga/123')).toBe('anilist_url');
    expect(campoPorDominio('https://myanimelist.net/manga/123')).toBe('myanimelist_url');
    expect(campoPorDominio('https://www.mangaupdates.com/series/abc')).toBe('mangaupdates_url');
    expect(campoPorDominio('https://mangadex.org/title/abc')).toBe('mangadex_url');
    expect(campoPorDominio('https://mangabaka.dev/series/abc')).toBe('mangabaka_url');
  });

  it('retorna null para um domínio de leitura comum (vira fonte genérica)', () => {
    expect(campoPorDominio('https://ezmanga.org/series/foo')).toBeNull();
    expect(campoPorDominio('https://coolscans.net/manga/bar')).toBeNull();
  });
});

describe('colunaCsvDaFonte', () => {
  it('comix.to cai na coluna comix', () => {
    expect(colunaCsvDaFonte('https://comix.to/series/foo')).toBe('comix');
  });

  it('sites licenciados (Manta, WebToon, Tappytoon, Tapas, Lezhin) caem em official_sources', () => {
    expect(colunaCsvDaFonte('https://manta.net/series/foo')).toBe('official_sources');
    expect(colunaCsvDaFonte('https://www.webtoons.com/en/action/foo')).toBe('official_sources');
    expect(colunaCsvDaFonte('https://m.webtoons.com/en/action/foo')).toBe('official_sources');
    expect(colunaCsvDaFonte('https://tappytoon.com/series/foo')).toBe('official_sources');
    expect(colunaCsvDaFonte('https://tapas.io/series/foo')).toBe('official_sources');
    expect(colunaCsvDaFonte('https://m.tapas.io/series/foo')).toBe('official_sources');
    expect(colunaCsvDaFonte('https://www.lezhinus.com/en/foo')).toBe('official_sources');
  });

  it('demais domínios (scanlations genéricas) caem em sources', () => {
    expect(colunaCsvDaFonte('https://ezmanga.org/series/foo')).toBe('sources');
    expect(colunaCsvDaFonte('https://coolscans.net/manga/bar')).toBe('sources');
  });

  it('não confunde subdomínio de terceiro com o domínio oficial (só sufixo exato bate)', () => {
    expect(colunaCsvDaFonte('https://notmanta.net/series/foo')).toBe('sources');
  });
});
