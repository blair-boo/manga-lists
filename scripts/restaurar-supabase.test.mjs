import { describe, expect, it } from 'vitest';
import {
  chavesPrimariasDoOpenApi,
  ehErroDeChaveEstrangeira,
  escolherBackup,
  lerArgumentos,
  lotes,
  tipoMime,
  validarBackup,
} from './restaurar-supabase.mjs';

describe('escolherBackup', () => {
  it('pega o mais novo', () => {
    expect(escolherBackup(['2026-09-27', '2026-10-09', '2026-10-04'])).toBe('2026-10-09');
  });

  it('devolve null sem backups', () => {
    expect(escolherBackup([])).toBeNull();
  });
});

describe('validarBackup', () => {
  const manifest = { linhas: { contas: 2, itens: 0 } };

  it('backup íntegro não tem problemas', () => {
    expect(validarBackup(manifest, { contas: [{}, {}], itens: [] })).toEqual([]);
  });

  it('acusa arquivo ausente, JSON ilegível e contagem diferente', () => {
    expect(validarBackup(manifest, { contas: [{}] })).toEqual([
      'contas: o manifest diz 2 linhas, o arquivo tem 1',
      'itens: arquivo ausente no backup',
    ]);
    expect(validarBackup(manifest, { contas: null, itens: [] })).toEqual(['contas: JSON ilegível']);
  });

  it('acusa arquivo fora do manifest', () => {
    expect(validarBackup(manifest, { contas: [{}, {}], itens: [], extra: [] })).toEqual(['extra: arquivo fora do manifest']);
  });

  it('manifest ausente ou sem linhas é problema', () => {
    expect(validarBackup(null, {})).toEqual(['manifest.json ausente ou inválido']);
    expect(validarBackup({}, {})).toEqual(['manifest.json ausente ou inválido']);
  });
});

describe('lotes', () => {
  it('divide em pedaços do tamanho pedido', () => {
    expect(lotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(lotes([], 2)).toEqual([]);
  });
});

describe('tipoMime', () => {
  it('reconhece os comuns e cai em octet-stream', () => {
    expect(tipoMime('capa.PNG')).toBe('image/png');
    expect(tipoMime('doc.pdf')).toBe('application/pdf');
    expect(tipoMime('sem-extensao')).toBe('application/octet-stream');
  });
});

describe('ehErroDeChaveEstrangeira', () => {
  it('só o código 23503 conta', () => {
    expect(ehErroDeChaveEstrangeira('{"code":"23503","message":"fk"}')).toBe(true);
    expect(ehErroDeChaveEstrangeira('{"code":"23505"}')).toBe(false);
    expect(ehErroDeChaveEstrangeira('não é json')).toBe(false);
  });
});

describe('lerArgumentos', () => {
  it('entende verificar e restaurar com opções', () => {
    expect(lerArgumentos(['--verificar'])).toMatchObject({ modo: 'verificar', executar: false });
    expect(lerArgumentos(['--restaurar', '--confirmo', 'x.supabase.co', '--arquivos', '--executar', '--backup', 'db/monthly/2026-10'])).toEqual({
      modo: 'restaurar',
      backup: 'db/monthly/2026-10',
      executar: true,
      arquivos: true,
      confirmo: 'x.supabase.co',
    });
  });

  it('exige um modo e recusa argumentos ou caminhos inválidos', () => {
    expect(() => lerArgumentos([])).toThrow('--verificar ou --restaurar');
    expect(() => lerArgumentos(['--verificar', '--foo'])).toThrow('desconhecido');
    expect(() => lerArgumentos(['--verificar', '--backup', '../etc'])).toThrow('--backup inválido');
  });
});

describe('chavesPrimariasDoOpenApi', () => {
  it('só inclui tabelas com chave primária declarada', () => {
    const spec = {
      definitions: {
        contas: { properties: { id: { description: 'Note:\nThis is a Primary Key.<pk/>' }, nome: {} } },
        item_tags: { properties: { item_id: { description: '<pk/>' }, tag_id: { description: '<pk/>' } } },
        visao: { properties: { x: {} } },
      },
    };
    expect(chavesPrimariasDoOpenApi(spec)).toEqual({ contas: ['id'], item_tags: ['item_id', 'tag_id'] });
  });
});
