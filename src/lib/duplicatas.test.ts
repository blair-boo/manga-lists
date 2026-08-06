import { describe, expect, it } from 'vitest';
import { escolherDuplicata, normalizarTitulo } from './duplicatas';
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
    criado_em: '2026-01-01T00:00:00Z',
    atualizado_em: '2026-01-01T00:00:00Z',
    ...parcial,
  };
}

describe('normalizarTitulo', () => {
  it('ignora acento, caixa e pontuação', () => {
    expect(normalizarTitulo('Re:Zero')).toBe(normalizarTitulo('re zero'));
    expect(normalizarTitulo('Solo Levéling!')).toBe('solo leveling');
  });
});

describe('escolherDuplicata', () => {
  const obras = [
    obraFake({ id: '1', titulo: 'Solo Leveling' }),
    obraFake({ id: '2', titulo: 'Omniscient Reader', titulos_alternativos: ['ORV'] }),
  ];

  it('título idêntico (ignorando caixa) é duplicata exata', () => {
    const r = escolherDuplicata(obras, 'solo leveling');
    expect(r?.obra.id).toBe('1');
    expect(r?.exata).toBe(true);
  });

  it('título só parecido é suspeita, não bloqueio', () => {
    const r = escolherDuplicata(obras, 'Solo Leveling!!');
    expect(r?.obra.id).toBe('1');
    expect(r?.exata).toBe(false);
  });

  it('bate também contra um título alternativo', () => {
    const r = escolherDuplicata(obras, 'orv');
    expect(r?.obra.id).toBe('2');
    expect(r?.exata).toBe(false);
  });

  it('sem parecido nenhum devolve null', () => {
    expect(escolherDuplicata(obras, 'Berserk')).toBeNull();
  });

  it('título vazio ou só pontuação não acusa nada', () => {
    expect(escolherDuplicata(obras, '   ')).toBeNull();
    expect(escolherDuplicata(obras, '!!!')).toBeNull();
  });

  // Ponto crítico do Edit mode: a obra editada já existe no banco, então sem
  // excluirId toda edição de título acusaria duplicata contra ela mesma.
  it('excluirId tira a própria obra da busca', () => {
    expect(escolherDuplicata(obras, 'Solo Leveling', '1')).toBeNull();
  });

  it('excluirId não esconde uma duplicata de verdade em outra obra', () => {
    const comColisao = [...obras, obraFake({ id: '3', titulo: 'Solo Leveling' })];
    const r = escolherDuplicata(comColisao, 'Solo Leveling', '3');
    expect(r?.obra.id).toBe('1');
    expect(r?.exata).toBe(true);
  });

  it('duplicata exata ganha de uma parecida encontrada antes', () => {
    const lista = [
      obraFake({ id: '1', titulo: 'Solo Leveling!!' }),
      obraFake({ id: '2', titulo: 'Solo Leveling' }),
    ];
    const r = escolherDuplicata(lista, 'Solo Leveling');
    expect(r?.obra.id).toBe('2');
    expect(r?.exata).toBe(true);
  });
});
