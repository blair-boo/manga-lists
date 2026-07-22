import { describe, expect, it } from 'vitest';
import { buildUpdatePayload, obrasParaCsv, parseCsvFile } from './csvBulkUpdate';
import type { Obra } from '../types';

describe('parseCsvFile', () => {
  it('lê o cabeçalho e as linhas, pulando linhas vazias', () => {
    const linhas = parseCsvFile('id,titulo,autor\n1,Solo Leveling,Chugong\n\n2,Omniscient Reader,singNsong\n');
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toMatchObject({ id: '1', titulo: 'Solo Leveling', autor: 'Chugong' });
    expect(linhas[1]).toMatchObject({ id: '2', titulo: 'Omniscient Reader' });
  });
});

describe('buildUpdatePayload', () => {
  it('célula vazia não entra no payload (mantém o valor atual)', () => {
    const payload = buildUpdatePayload({ id: '1', titulo: 'X', autor: '', nota: '', tags: '' });
    expect(payload).toEqual({});
  });

  it('preenche texto e número quando presentes', () => {
    const payload = buildUpdatePayload({ id: '1', autor: 'Chugong', nota: '5', capitulo_atual: '12.5' });
    expect(payload).toEqual({ autor: 'Chugong', nota: 5, capitulo_atual: 12.5 });
  });

  it('ignora número inválido', () => {
    expect(buildUpdatePayload({ nota: 'abc' })).toEqual({});
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

describe('obrasParaCsv', () => {
  const obra: Obra = {
    id: 'abc-123',
    tipo: 'Manga',
    titulo: 'Solo Leveling',
    titulos_alternativos: ['Na Honjaman Level Up'],
    autor: 'Chugong',
    capa_url: null,
    capitulo_atual: 110,
    status_leitura: 'Reading',
    status_publicacao: 'Ongoing',
    fim_de_temporada: false,
    ultimo_capitulo_lancado: 179,
    ultimo_capitulo_via_scraper: true,
    nota: 5,
    generos: ['Action', 'Fantasy'],
    tags: null,
    observacoes: null,
    obra_vinculada_id: null,
    classificacao: null,
    novelupdates_url: null,
    pdf: false,
    criado_em: '2026-01-01T00:00:00Z',
    atualizado_em: '2026-01-01T00:00:00Z',
  };

  it('gera CSV que o buildUpdatePayload lê de volta (round-trip)', () => {
    const csv = obrasParaCsv([obra]);
    const [linha] = parseCsvFile(csv);
    expect(linha.id).toBe('abc-123');
    expect(linha.titulo).toBe('Solo Leveling');

    const payload = buildUpdatePayload(linha);
    expect(payload.autor).toBe('Chugong');
    expect(payload.nota).toBe(5);
    expect(payload.generos).toEqual(['Action', 'Fantasy']);
    expect(payload.titulos_alternativos).toEqual(['Na Honjaman Level Up']);
    // tags vazio no CSV → ausente do payload (não zera o valor no banco)
    expect(payload.tags).toBeUndefined();
  });
});
