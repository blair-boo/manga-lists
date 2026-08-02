import { describe, expect, it } from 'vitest';
import { FILTROS_PADRAO, obrasFiltradasOrdenadas, type FiltrosSalvos } from './filtrosLista';
import type { Fonte, Obra } from '../types';

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
    pdf: false,
    criado_em: '2026-01-01T00:00:00Z',
    atualizado_em: '2026-01-01T00:00:00Z',
    ...parcial,
  };
}

const semFontes = new Map<string, Fonte[]>();

describe('obrasFiltradasOrdenadas', () => {
  it('sem filtro nenhum, ordena por título', () => {
    const obras = [obraFake({ id: '1', titulo: 'Zeta' }), obraFake({ id: '2', titulo: 'Alfa' })];
    const resultado = obrasFiltradasOrdenadas(obras, semFontes, FILTROS_PADRAO, 'titulo');
    expect(resultado.map((o) => o.id)).toEqual(['2', '1']);
  });

  it('busca por título bate título e títulos alternativos', () => {
    const obras = [
      obraFake({ id: '1', titulo: 'One Piece' }),
      obraFake({ id: '2', titulo: 'Outro', titulos_alternativos: ['One Piece Colored'] }),
      obraFake({ id: '3', titulo: 'Sem relação' }),
    ];
    const filtros: FiltrosSalvos = { ...FILTROS_PADRAO, busca: 'one piece' };
    const resultado = obrasFiltradasOrdenadas(obras, semFontes, filtros, 'titulo');
    expect(resultado.map((o) => o.id).sort()).toEqual(['1', '2']);
  });

  it('filtroNovel em "incluir" só mostra Novel; Manga/Manwha/Manhua contam como manga', () => {
    const obras = [
      obraFake({ id: '1', titulo: 'A', tipo: 'Manga' }),
      obraFake({ id: '2', titulo: 'B', tipo: 'Manwha' }),
      obraFake({ id: '3', titulo: 'C', tipo: 'Manhua' }),
      obraFake({ id: '4', titulo: 'D', tipo: 'Novel' }),
    ];
    const filtros: FiltrosSalvos = { ...FILTROS_PADRAO, filtroNovel: 'incluir' };
    const resultado = obrasFiltradasOrdenadas(obras, semFontes, filtros, 'titulo');
    expect(resultado.map((o) => o.id)).toEqual(['4']);
  });

  it('filtroUnsourced em "excluir" some com quem não tem fonte', () => {
    const obras = [obraFake({ id: '1', titulo: 'A' }), obraFake({ id: '2', titulo: 'B' })];
    const fontesPorObra = new Map<string, Fonte[]>([
      [
        '1',
        [
          {
            id: 'f1',
            obra_id: '1',
            site: 'site',
            url: 'https://site.com',
            ultimo_capitulo_detectado: null,
            atualizado_por_scraper: false,
            confiavel: true,
            status_aprovacao: 'aprovado',
            descoberta_automaticamente: false,
            ultima_verificacao: null,
            tipo_detectado: null,
            tipo_manual: false,
            ordem: 0,
            criado_em: '2026-01-01T00:00:00Z',
          },
        ],
      ],
    ]);
    const filtros: FiltrosSalvos = { ...FILTROS_PADRAO, filtroUnsourced: 'excluir' };
    const resultado = obrasFiltradasOrdenadas(obras, fontesPorObra, filtros, 'titulo');
    expect(resultado.map((o) => o.id)).toEqual(['1']);
  });

  it('filtroSemCapa em "incluir" só mostra obras sem capa', () => {
    const obras = [
      obraFake({ id: '1', titulo: 'A', capa_url: 'https://img/a.jpg' }),
      obraFake({ id: '2', titulo: 'B', capa_url: null }),
    ];
    const filtros: FiltrosSalvos = { ...FILTROS_PADRAO, filtroSemCapa: 'incluir' };
    const resultado = obrasFiltradasOrdenadas(obras, semFontes, filtros, 'titulo');
    expect(resultado.map((o) => o.id)).toEqual(['2']);
  });

  it('filtroSemCapa em "excluir" some com quem não tem capa', () => {
    const obras = [
      obraFake({ id: '1', titulo: 'A', capa_url: 'https://img/a.jpg' }),
      obraFake({ id: '2', titulo: 'B', capa_url: null }),
    ];
    const filtros: FiltrosSalvos = { ...FILTROS_PADRAO, filtroSemCapa: 'excluir' };
    const resultado = obrasFiltradasOrdenadas(obras, semFontes, filtros, 'titulo');
    expect(resultado.map((o) => o.id)).toEqual(['1']);
  });

  it('capa como string vazia conta como sem capa', () => {
    const obras = [
      obraFake({ id: '1', titulo: 'A', capa_url: 'https://img/a.jpg' }),
      obraFake({ id: '2', titulo: 'B', capa_url: '' }),
    ];
    const filtros: FiltrosSalvos = { ...FILTROS_PADRAO, filtroSemCapa: 'incluir' };
    const resultado = obrasFiltradasOrdenadas(obras, semFontes, filtros, 'titulo');
    expect(resultado.map((o) => o.id)).toEqual(['2']);
  });

  it('filtroSemNu em "incluir" só mostra obras sem novelupdates_url', () => {
    const obras = [
      obraFake({ id: '1', titulo: 'A', novelupdates_url: 'https://novelupdates.com/a' }),
      obraFake({ id: '2', titulo: 'B', novelupdates_url: null }),
    ];
    const filtros: FiltrosSalvos = { ...FILTROS_PADRAO, filtroSemNu: 'incluir' };
    const resultado = obrasFiltradasOrdenadas(obras, semFontes, filtros, 'titulo');
    expect(resultado.map((o) => o.id)).toEqual(['2']);
  });

  it('novelupdates_url undefined (registro legado) conta como sem link', () => {
    const obras = [
      obraFake({ id: '1', titulo: 'A', novelupdates_url: 'https://novelupdates.com/a' }),
      obraFake({ id: '2', titulo: 'B', novelupdates_url: undefined as unknown as null }),
    ];
    const filtros: FiltrosSalvos = { ...FILTROS_PADRAO, filtroSemNu: 'incluir' };
    const resultado = obrasFiltradasOrdenadas(obras, semFontes, filtros, 'titulo');
    expect(resultado.map((o) => o.id)).toEqual(['2']);
  });
});
