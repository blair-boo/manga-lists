import { describe, expect, it } from 'vitest';
import { buildUpdatePayload, obrasParaCsv, parseCsvFile, sourcesDaLinha, unirArrays } from './csvBulkUpdate';
import type { Fonte, Obra } from '../types';

describe('sourcesDaLinha', () => {
  it('coluna ausente retorna undefined (não mexe nas fontes)', () => {
    expect(sourcesDaLinha({ id: '1' })).toBeUndefined();
  });

  it('coluna presente e vazia retorna array vazio (limpa todas as fontes)', () => {
    expect(sourcesDaLinha({ id: '1', sources: '' })).toEqual([]);
  });

  it('separa por ; e ignora espaços', () => {
    expect(sourcesDaLinha({ sources: 'https://a.com/x; https://b.com/y' })).toEqual([
      'https://a.com/x',
      'https://b.com/y',
    ]);
  });

  it('colapsa URLs duplicadas', () => {
    expect(sourcesDaLinha({ sources: 'https://a.com/x; https://a.com/x' })).toEqual(['https://a.com/x']);
  });
});

describe('parseCsvFile', () => {
  it('lê o cabeçalho e as linhas, pulando linhas vazias', () => {
    const { linhas, linhasComProblema } = parseCsvFile(
      'id,titulo,autor\n1,Solo Leveling,Chugong\n\n2,Omniscient Reader,singNsong\n'
    );
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toMatchObject({ id: '1', titulo: 'Solo Leveling', autor: 'Chugong' });
    expect(linhas[1]).toMatchObject({ id: '2', titulo: 'Omniscient Reader' });
    expect(linhasComProblema).toBe(0);
  });

  it('reporta linha com campos a mais (ex.: vírgula não citada num timestamp reformatado)', () => {
    // atualizado_em reformatado por planilha com vírgula sem aspas quebra o
    // alinhamento dessa linha; id/titulo/autor (antes do ponto de quebra)
    // ainda são lidos normalmente.
    const csv =
      'id,titulo,autor,criado_em,atualizado_em\n' +
      'abc-123,Solo Leveling,Chugong,7/12/2026 6:51:32 PM,7/23/2026, 8:30:10 PM\n' +
      'def-456,Omniscient Reader,singNsong,7/12/2026 6:51:32 PM,7/23/2026 8:31:00 PM\n';
    const { linhas, linhasComProblema } = parseCsvFile(csv);
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toMatchObject({ id: 'abc-123', titulo: 'Solo Leveling', autor: 'Chugong' });
    expect(linhasComProblema).toBe(1);
  });
});

describe('buildUpdatePayload', () => {
  it('coluna ausente do CSV não entra no payload (não mexe)', () => {
    const payload = buildUpdatePayload({ id: '1', titulo: 'X' });
    expect(payload).toEqual({});
  });

  it('coluna presente porém vazia limpa o campo (null)', () => {
    const payload = buildUpdatePayload({ id: '1', titulo: 'X', autor: '', score: '', tags: '' });
    expect(payload).toEqual({ autor: null, score: null, tags: null });
  });

  it('preenche texto e número quando presentes', () => {
    const payload = buildUpdatePayload({ id: '1', autor: 'Chugong', score: '5', capitulo_atual: '12.5' });
    expect(payload).toEqual({ autor: 'Chugong', score: 5, capitulo_atual: 12.5 });
  });

  it('lê a coluna "notes" pro campo observacoes', () => {
    expect(buildUpdatePayload({ notes: 'Reler quando sair o volume 3' })).toEqual({
      observacoes: 'Reler quando sair o volume 3',
    });
    expect(buildUpdatePayload({ notes: '' })).toEqual({ observacoes: null });
  });

  it('coluna "observacoes" (nome antigo) não é reconhecida — só "notes"', () => {
    expect(buildUpdatePayload({ observacoes: 'texto' })).toEqual({});
  });

  it('atualiza novelupdates_url e classificacao', () => {
    const payload = buildUpdatePayload({
      novelupdates_url: 'https://www.novelupdates.com/series/solo-leveling/',
      classificacao: 'R-18',
    });
    expect(payload).toEqual({
      novelupdates_url: 'https://www.novelupdates.com/series/solo-leveling/',
      classificacao: 'R-18',
    });
  });

  it('limpa novelupdates_url quando a célula vem vazia', () => {
    expect(buildUpdatePayload({ novelupdates_url: '' })).toEqual({ novelupdates_url: null });
  });

  it('booleanos: presente vira true/false, vazio vira false', () => {
    expect(buildUpdatePayload({ pdf: 'true', fim_de_temporada: 'false' })).toEqual({
      pdf: true,
      fim_de_temporada: false,
    });
    expect(buildUpdatePayload({ pdf: '' })).toEqual({ pdf: false });
  });

  it('número inválido é ignorado (não limpa)', () => {
    expect(buildUpdatePayload({ score: 'abc' })).toEqual({});
  });

  it('coluna status_publicacao presente trava status_publicacao_manual (mesma célula vazia ou preenchida)', () => {
    expect(buildUpdatePayload({ status_publicacao: 'Hiatus' })).toEqual({
      status_publicacao: 'Hiatus',
      status_publicacao_manual: true,
    });
    expect(buildUpdatePayload({ status_publicacao: '' })).toEqual({
      status_publicacao: null,
      status_publicacao_manual: true,
    });
  });

  it('status_publicacao ausente do CSV não mexe na trava manual', () => {
    expect(buildUpdatePayload({ autor: 'Chugong' })).toEqual({ autor: 'Chugong' });
  });

  it('arrays separados por ;', () => {
    const payload = buildUpdatePayload({ generos: 'Action; Fantasy;Drama' });
    expect(payload.generos).toEqual(['Action', 'Fantasy', 'Drama']);
  });

  it('arrays no formato {a,b} do Postgres', () => {
    const payload = buildUpdatePayload({ tags: '{isekai, cultivo}' });
    expect(payload.tags).toEqual(['isekai', 'cultivo']);
  });

  it('arrays no formato JSON', () => {
    const payload = buildUpdatePayload({ titulos_alternativos: '["Na Honjaman Level Up", "俺だけレベルアップな件"]' });
    expect(payload.titulos_alternativos).toEqual(['Na Honjaman Level Up', '俺だけレベルアップな件']);
  });
});

describe('unirArrays', () => {
  it('soma valores novos sem duplicar, preservando a ordem do atual primeiro', () => {
    expect(unirArrays(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('atual nulo/ausente vira só os valores novos', () => {
    expect(unirArrays(null, ['x'])).toEqual(['x']);
    expect(unirArrays(undefined, ['x'])).toEqual(['x']);
  });
});

describe('buildUpdatePayload — modo complementar (Modo 2)', () => {
  it('célula vazia não mexe no campo (em vez de limpar)', () => {
    expect(buildUpdatePayload({ autor: '', score: '', tags: '' }, 'complementar')).toEqual({});
  });

  it('célula com valor sobrescreve campo texto/número normalmente', () => {
    expect(buildUpdatePayload({ autor: 'Chugong', score: '5' }, 'complementar')).toEqual({ autor: 'Chugong', score: 5 });
  });

  it('campo array une com o valor atual da obra em vez de substituir', () => {
    const obraAtual = { generos: ['Action'], tags: null, titulos_alternativos: null };
    const payload = buildUpdatePayload({ generos: 'Fantasy; Action' }, 'complementar', obraAtual);
    expect(payload.generos).toEqual(['Action', 'Fantasy']);
  });

  it('sem obraAtual, campo array vira só os valores novos', () => {
    const payload = buildUpdatePayload({ tags: 'isekai' }, 'complementar');
    expect(payload.tags).toEqual(['isekai']);
  });

  it('status_publicacao só trava a edição manual quando vem com valor (célula vazia não mexe em nada)', () => {
    expect(buildUpdatePayload({ status_publicacao: '' }, 'complementar')).toEqual({});
    expect(buildUpdatePayload({ status_publicacao: 'Hiatus' }, 'complementar')).toEqual({
      status_publicacao: 'Hiatus',
      status_publicacao_manual: true,
    });
  });
});

describe('obrasParaCsv', () => {
  const obra: Obra = {
    id: 'abc-123',
    tipo: 'Manga',
    titulo: 'Solo Leveling',
    titulos_alternativos: ['Na Honjaman Level Up'],
    autor: 'Chugong',
    artistas: null,
    capa_url: null,
    capitulo_atual: 110,
    status_leitura: 'Reading',
    status_publicacao: 'Ongoing',
    status_publicacao_manual: true,
    fim_de_temporada: false,
    ultimo_capitulo_lancado: 179,
    ultimo_capitulo_via_scraper: true,
    score: 5,
    generos: ['Action', 'Fantasy'],
    tags: null,
    observacoes: 'Reler depois do anime',
    obra_vinculada_id: null,
    classificacao: 'R-18',
    novelupdates_url: 'https://www.novelupdates.com/series/solo-leveling/',
    anilist_url: null,
    myanimelist_url: null,
    mangaupdates_url: null,
    mangadex_url: null,
    mangabaka_url: null,
    pdf: true,
    favorito: false,
    criado_em: '2026-01-01T00:00:00Z',
    atualizado_em: '2026-01-01T00:00:00Z',
  };

  it('gera CSV que o buildUpdatePayload lê de volta (round-trip)', () => {
    const csv = obrasParaCsv([obra]);
    const { linhas } = parseCsvFile(csv);
    const [linha] = linhas;
    expect(linha.id).toBe('abc-123');
    expect(linha.titulo).toBe('Solo Leveling');
    expect(linha.notes).toBe('Reler depois do anime');
    expect(linha.observacoes).toBeUndefined();

    const payload = buildUpdatePayload(linha);
    expect(payload.autor).toBe('Chugong');
    expect(payload.score).toBe(5);
    expect(payload.observacoes).toBe('Reler depois do anime');
    expect(payload.generos).toEqual(['Action', 'Fantasy']);
    expect(payload.titulos_alternativos).toEqual(['Na Honjaman Level Up']);
    expect(payload.classificacao).toBe('R-18');
    expect(payload.novelupdates_url).toBe('https://www.novelupdates.com/series/solo-leveling/');
    expect(payload.pdf).toBe(true);
    expect(payload.ultimo_capitulo_via_scraper).toBe(true);
    expect(payload.ultimo_capitulo_lancado).toBe(179);
    // tags null no banco → coluna presente e vazia no CSV → volta como null (limpa)
    expect(payload.tags).toBeNull();
  });

  it('coluna sources lista as URLs das fontes da obra, separadas por ;', () => {
    const fontesPorObra = new Map<string, Fonte[]>([
      [
        'abc-123',
        [
          { url: 'https://ezmanga.org/solo-leveling' } as Fonte,
          { url: 'https://nyxscans.com/solo-leveling' } as Fonte,
        ],
      ],
    ]);
    const csv = obrasParaCsv([obra], fontesPorObra);
    const { linhas } = parseCsvFile(csv);
    expect(linhas[0].sources).toBe('https://ezmanga.org/solo-leveling; https://nyxscans.com/solo-leveling');
  });

  it('sem fontesPorObra, a coluna sources sai vazia', () => {
    const csv = obrasParaCsv([obra]);
    const { linhas } = parseCsvFile(csv);
    expect(linhas[0].sources).toBe('');
  });
});
