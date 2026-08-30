import { describe, expect, it } from 'vitest';
import { interpretarAlerta } from './scrapingApiAlerta';

describe('interpretarAlerta', () => {
  it('devolve null no estado normal (todos os estágios limpos)', () => {
    // Com os providers em stand-by e os sites respondendo direto, cada run
    // grava a própria chave com hosts vazio. Nada a avisar.
    expect(
      interpretarAlerta({
        capitulos: { hosts: {}, em: '2026-08-30T12:00:00Z' },
        obras: { hosts: {}, em: '2026-08-30T13:00:00Z' },
      })
    ).toBeNull();
  });

  it('acusa o host bloqueado e a data da detecção', () => {
    const alerta = interpretarAlerta({
      capitulos: { hosts: { 'comix.to': 'HTTP 403 (possível Cloudflare)' }, em: '2026-08-30T12:00:00Z' },
    });
    expect(alerta).toEqual({ hosts: ['comix.to'], detectadoEm: '2026-08-30T12:00:00Z' });
  });

  it('junta hosts de estágios diferentes, sem repetir', () => {
    const alerta = interpretarAlerta({
      capitulos: { hosts: { 'comix.to': 'x' }, em: '2026-08-30T12:00:00Z' },
      obras: { hosts: { 'comix.to': 'x', 'comix.ws': 'y' }, em: '2026-08-30T13:00:00Z' },
    });
    expect(alerta?.hosts).toEqual(['comix.to', 'comix.ws']);
  });

  it('usa a data mais recente entre os estágios que ainda acusam bloqueio', () => {
    const alerta = interpretarAlerta({
      capitulos: { hosts: { 'comix.to': 'x' }, em: '2026-08-30T12:00:00Z' },
      obras: { hosts: { 'comix.ws': 'y' }, em: '2026-08-31T09:00:00Z' },
    });
    expect(alerta?.detectadoEm).toBe('2026-08-31T09:00:00Z');
  });

  it('ignora a data de um estágio que rodou limpo', () => {
    // O estágio de obras é mais recente, mas não achou bloqueio nenhum — a
    // data mostrada tem que ser a da detecção real, não a da última run.
    const alerta = interpretarAlerta({
      capitulos: { hosts: { 'comix.to': 'x' }, em: '2026-08-30T12:00:00Z' },
      obras: { hosts: {}, em: '2026-08-31T09:00:00Z' },
    });
    expect(alerta).toEqual({ hosts: ['comix.to'], detectadoEm: '2026-08-30T12:00:00Z' });
  });

  it('aguenta linha ausente ou formato inesperado', () => {
    expect(interpretarAlerta(null)).toBeNull();
    expect(interpretarAlerta(undefined)).toBeNull();
    expect(interpretarAlerta('texto')).toBeNull();
    expect(interpretarAlerta({})).toBeNull();
    expect(interpretarAlerta({ capitulos: null })).toBeNull();
    expect(interpretarAlerta({ capitulos: { em: '2026-08-30T12:00:00Z' } })).toBeNull();
  });
});
