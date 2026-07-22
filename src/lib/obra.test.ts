import { describe, expect, it } from 'vitest';
import { capitulosAtrasados, familiaDeTipo, temNovoCapitulo } from './obra';
import type { Obra } from '../types';

function obraFake(parcial: Partial<Obra>): Obra {
  return {
    id: 'x',
    tipo: null,
    titulo: 'Obra de teste',
    titulos_alternativos: null,
    autor: null,
    capa_url: null,
    capitulo_atual: null,
    status_leitura: null,
    status_publicacao: null,
    fim_de_temporada: false,
    ultimo_capitulo_lancado: null,
    ultimo_capitulo_via_scraper: false,
    nota: null,
    generos: null,
    tags: null,
    observacoes: null,
    obra_vinculada_id: null,
    classificacao: null,
    novelupdates_url: null,
    pdf: false,
    criado_em: '2026-01-01T00:00:00Z',
    atualizado_em: '2026-01-01T00:00:00Z',
    ...parcial,
  };
}

describe('familiaDeTipo', () => {
  it('agrupa Manga/Manwha/Manhua na família manga', () => {
    expect(familiaDeTipo('Manga')).toBe('manga');
    expect(familiaDeTipo('Manwha')).toBe('manga');
    expect(familiaDeTipo('Manhua')).toBe('manga');
  });

  it('Novel vira novel, e null fica indefinido', () => {
    expect(familiaDeTipo('Novel')).toBe('novel');
    expect(familiaDeTipo(null)).toBeNull();
  });
});

describe('temNovoCapitulo', () => {
  it('true quando o scraper confirmou capítulo maior que o lido', () => {
    expect(
      temNovoCapitulo(obraFake({ ultimo_capitulo_via_scraper: true, ultimo_capitulo_lancado: 12, capitulo_atual: 10 }))
    ).toBe(true);
  });

  it('false quando o valor não veio do scraper', () => {
    expect(
      temNovoCapitulo(obraFake({ ultimo_capitulo_via_scraper: false, ultimo_capitulo_lancado: 12, capitulo_atual: 10 }))
    ).toBe(false);
  });

  it('false quando está em dia ou faltam dados', () => {
    expect(
      temNovoCapitulo(obraFake({ ultimo_capitulo_via_scraper: true, ultimo_capitulo_lancado: 10, capitulo_atual: 10 }))
    ).toBe(false);
    expect(
      temNovoCapitulo(obraFake({ ultimo_capitulo_via_scraper: true, ultimo_capitulo_lancado: null, capitulo_atual: 10 }))
    ).toBe(false);
    expect(
      temNovoCapitulo(obraFake({ ultimo_capitulo_via_scraper: true, ultimo_capitulo_lancado: 12, capitulo_atual: null }))
    ).toBe(false);
  });
});

describe('capitulosAtrasados', () => {
  it('conta capítulos não lidos, com mínimo em zero', () => {
    expect(capitulosAtrasados(obraFake({ ultimo_capitulo_lancado: 15, capitulo_atual: 10 }))).toBe(5);
    expect(capitulosAtrasados(obraFake({ ultimo_capitulo_lancado: 10, capitulo_atual: 15 }))).toBe(0);
    expect(capitulosAtrasados(obraFake({ ultimo_capitulo_lancado: null, capitulo_atual: 10 }))).toBe(0);
  });
});
