import { describe, expect, it } from 'vitest';
import { listarFontesTipoDivergente } from './fonteTipo';
import type { Fonte, Obra } from '../types';

function obraFake(parcial: Partial<Obra>): Obra {
  return {
    id: 'obra-x',
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
    criado_em: '2026-01-01T00:00:00Z',
    atualizado_em: '2026-01-01T00:00:00Z',
    ...parcial,
  };
}

function fonteFake(parcial: Partial<Fonte>): Fonte {
  return {
    id: 'fonte-x',
    obra_id: 'obra-x',
    site: null,
    url: 'https://exemplo.com/obra',
    ultimo_capitulo_detectado: null,
    atualizado_por_scraper: false,
    confiavel: true,
    status_aprovacao: 'aprovado',
    descoberta_automaticamente: true,
    ultima_verificacao: null,
    criado_em: '2026-01-01T00:00:00Z',
    tipo_detectado: null,
    tipo_manual: false,
    ordem: null,
    ...parcial,
  };
}

describe('listarFontesTipoDivergente', () => {
  it('ignora fonte sem tipo_detectado', () => {
    const obra = obraFake({ id: 'o1', tipo: 'Manga' });
    const fonte = fonteFake({ id: 'f1', obra_id: 'o1', tipo_detectado: null });
    expect(listarFontesTipoDivergente([fonte], [obra])).toEqual([]);
  });

  it('ignora quando a família bate com a obra', () => {
    const obra = obraFake({ id: 'o1', tipo: 'Manhwa' });
    const fonte = fonteFake({ id: 'f1', obra_id: 'o1', tipo_detectado: 'manga' });
    expect(listarFontesTipoDivergente([fonte], [obra])).toEqual([]);
  });

  it('ignora quando a obra não tem tipo definido', () => {
    const obra = obraFake({ id: 'o1', tipo: null });
    const fonte = fonteFake({ id: 'f1', obra_id: 'o1', tipo_detectado: 'novel' });
    expect(listarFontesTipoDivergente([fonte], [obra])).toEqual([]);
  });

  it('ignora fonte cuja obra não existe mais', () => {
    const fonte = fonteFake({ id: 'f1', obra_id: 'inexistente', tipo_detectado: 'novel' });
    expect(listarFontesTipoDivergente([fonte], [])).toEqual([]);
  });

  it('diverge sem obra vinculada: obraCorrespondente null', () => {
    const obra = obraFake({ id: 'o1', tipo: 'Manga', obra_vinculada_id: null });
    const fonte = fonteFake({ id: 'f1', obra_id: 'o1', tipo_detectado: 'novel' });
    const resultado = listarFontesTipoDivergente([fonte], [obra]);
    expect(resultado).toHaveLength(1);
    expect(resultado[0].obraCorrespondente).toBeNull();
  });

  it('diverge com obra vinculada de família errada: ainda null', () => {
    const obra = obraFake({ id: 'o1', tipo: 'Manga', obra_vinculada_id: 'o2' });
    const vinculada = obraFake({ id: 'o2', tipo: 'Manhwa' });
    const fonte = fonteFake({ id: 'f1', obra_id: 'o1', tipo_detectado: 'novel' });
    const resultado = listarFontesTipoDivergente([fonte], [obra, vinculada]);
    expect(resultado[0].obraCorrespondente).toBeNull();
  });

  it('diverge com obra vinculada de família certa: obraCorrespondente preenchido', () => {
    const obra = obraFake({ id: 'o1', titulo: 'B', tipo: 'Manga', obra_vinculada_id: 'o2' });
    const vinculada = obraFake({ id: 'o2', tipo: 'Novel' });
    const fonte = fonteFake({ id: 'f1', obra_id: 'o1', tipo_detectado: 'novel' });
    const resultado = listarFontesTipoDivergente([fonte], [obra, vinculada]);
    expect(resultado).toHaveLength(1);
    expect(resultado[0].obraCorrespondente).toEqual(vinculada);
    expect(resultado[0].obraAtual).toEqual(obra);
    expect(resultado[0].fonte).toEqual(fonte);
  });

  it('ordena por título da obra', () => {
    const obraB = obraFake({ id: 'o1', titulo: 'Zeta', tipo: 'Manga' });
    const obraA = obraFake({ id: 'o2', titulo: 'Alfa', tipo: 'Manga' });
    const fonteB = fonteFake({ id: 'f1', obra_id: 'o1', tipo_detectado: 'novel' });
    const fonteA = fonteFake({ id: 'f2', obra_id: 'o2', tipo_detectado: 'novel' });
    const resultado = listarFontesTipoDivergente([fonteB, fonteA], [obraB, obraA]);
    expect(resultado.map((r) => r.obraAtual.titulo)).toEqual(['Alfa', 'Zeta']);
  });
});
