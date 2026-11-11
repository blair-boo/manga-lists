import { describe, expect, it } from 'vitest';
import {
  acharAlvoInicial,
  codificarNovel,
  decodificarNovel,
  planoDoAlvo,
  urlNuComparavel,
  type NovelImportada,
} from './novelupdatesImport';
import type { Obra } from '../types';

function obraFake(parcial: Partial<Obra>): Obra {
  return {
    id: 'x',
    tipo: null,
    titulo: 'Obra de teste',
    titulos_alternativos: null,
    autor: null,
    artistas: null,
    capa_url: null,
    capitulo_atual: null,
    status_leitura: null,
    status_publicacao: null,
    status_publicacao_manual: false,
    fim_de_temporada: false,
    ultimo_capitulo_lancado: null,
    ultimo_capitulo_via_scraper: false,
    score: null,
    generos: null,
    tags: null,
    observacoes: null,
    obra_vinculada_id: null,
    classificacao: null,
    novelupdates_url: null,
    anilist_url: null,
    myanimelist_url: null,
    mangaupdates_url: null,
    mangadex_url: null,
    mangabaka_url: null,
    pdf: false,
    favorito: false,
    nostalgic: false,
    criado_em: '2026-01-01T00:00:00Z',
    atualizado_em: '2026-01-01T00:00:00Z',
    ...parcial,
  };
}

const novelFake: NovelImportada = {
  slug: 's-class-except-me',
  titulo: 'S-Class, Except Me',
  titulosAlternativos: ['S급, 나 빼고', 'Only I Am Not S-Class'],
  statusPublicacao: 'Completed',
  statusPublicacaoBruto: null,
  capaUrl: 'https://cdn.novelupdates.com/images/example.jpg',
  url: 'https://www.novelupdates.com/series/s-class-except-me/',
  autores: ['Author'],
  artistas: [],
  generos: ['Action'],
  tags: ['Weak to Strong'],
};

describe('codificarNovel / decodificarNovel', () => {
  it('round-trip preserva o payload, inclusive títulos coreanos e capaBase64', () => {
    const comCapa: NovelImportada = { ...novelFake, capaBase64: 'data:image/jpeg;base64,AAAA' };
    expect(decodificarNovel(codificarNovel(comCapa))).toEqual(comCapa);
  });

  it('payload inválido lança erro legível', () => {
    expect(() => decodificarNovel('@@@ não é base64 @@@')).toThrow('Invalid Novel Updates payload');
  });
});

describe('urlNuComparavel', () => {
  it('ignora query, barra final e caixa', () => {
    expect(urlNuComparavel('https://www.novelupdates.com/series/Foo/?x=1')).toBe(
      'https://www.novelupdates.com/series/foo'
    );
    expect(urlNuComparavel(null)).toBe('');
  });
});

describe('acharAlvoInicial', () => {
  it('casa pela URL do NU já gravada, antes de olhar títulos', () => {
    const obras = [
      obraFake({ id: 'a', titulo: 'Outro nome', novelupdates_url: 'https://www.novelupdates.com/series/s-class-except-me' }),
      obraFake({ id: 'b', titulo: 'S-Class, Except Me' }),
    ];
    expect(acharAlvoInicial(obras, novelFake)).toBe('a');
  });

  it('casa por título principal ou alternativo quando não há link', () => {
    const obras = [obraFake({ id: 'b', titulo: 'Only I Am Not S-Class', tipo: 'Manhwa' })];
    expect(acharAlvoInicial(obras, novelFake)).toBe('b');
  });

  it('sem correspondência devolve string vazia', () => {
    expect(acharAlvoInicial([obraFake({ id: 'z', titulo: 'Nada a ver' })], novelFake)).toBe('');
  });
});

describe('planoDoAlvo', () => {
  it('sem alvo: cria obra nova', () => {
    expect(planoDoAlvo([], '')).toEqual({ tipo: 'criarNova' });
  });

  it('alvo Novel: atualiza a própria obra', () => {
    const novel = obraFake({ id: 'n', tipo: 'Novel', titulo: 'A Novel' });
    expect(planoDoAlvo([novel], 'n')).toEqual({ tipo: 'atualizar', obra: novel });
  });

  it('alvo mangá sem contraparte: cria a Novel vinculada ao mangá', () => {
    const manga = obraFake({ id: 'm', tipo: 'Manhwa', titulo: 'A Manhwa' });
    expect(planoDoAlvo([manga], 'm')).toEqual({ tipo: 'criarVinculada', manga });
  });

  it('alvo mangá que já tem Novel vinculada: atualiza a Novel existente', () => {
    const novel = obraFake({ id: 'n', tipo: 'Novel', titulo: 'A Novel', obra_vinculada_id: 'm' });
    const manga = obraFake({ id: 'm', tipo: 'Manga', titulo: 'A Manga', obra_vinculada_id: 'n' });
    expect(planoDoAlvo([manga, novel], 'm')).toEqual({ tipo: 'atualizar', obra: novel });
  });
});
