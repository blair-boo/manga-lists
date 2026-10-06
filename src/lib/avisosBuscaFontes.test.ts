import { describe, expect, it } from 'vitest';
import type { ScraperRun } from '../types';
import { avisoDaRun } from './avisosBuscaFontes';

const base = {
  id: '1',
  tipo: 'fontes',
  iniciado_em: '2026-10-01T00:00:00Z',
  finalizado_em: null,
  mensagem: null,
  resumo: null,
} as unknown as ScraperRun;

describe('avisoDaRun', () => {
  it('sem run ou run ok não avisa', () => {
    expect(avisoDaRun(null, false)).toBeNull();
    expect(avisoDaRun({ ...base, status: 'concluido' }, false)).toBeNull();
    expect(avisoDaRun({ ...base, status: 'rodando' }, false)).toBeNull();
  });

  it('erro avisa, exceto parada manual', () => {
    expect(avisoDaRun({ ...base, status: 'erro', mensagem: 'boom' }, false)).toMatch(/ended with an error/);
    expect(avisoDaRun({ ...base, status: 'erro', mensagem: 'Stopped manually' }, false)).toBeNull();
  });

  it('travada tem prioridade', () => {
    expect(avisoDaRun({ ...base, status: 'rodando' }, true)).toMatch(/stuck/);
  });
});
