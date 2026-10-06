import { describe, expect, it } from 'vitest';
import { backupAtrasado, formatarBytes, gravaMensal, limpaImagens, proximoBackup } from './backup';

describe('formatarBytes', () => {
  it('formata nas unidades certas', () => {
    expect(formatarBytes(0)).toBe('0 B');
    expect(formatarBytes(512)).toBe('512 B');
    expect(formatarBytes(1536)).toBe('1.5 KB');
    expect(formatarBytes(5 * 1024 ** 2)).toBe('5.0 MB');
    expect(formatarBytes(250 * 1024 ** 2)).toBe('250 MB');
    expect(formatarBytes(2.5 * 1024 ** 3)).toBe('2.5 GB');
  });
  it('lida com valores inválidos', () => {
    expect(formatarBytes(NaN)).toBe('0 B');
    expect(formatarBytes(-5)).toBe('0 B');
  });
});

describe('proximoBackup', () => {
  it('numa terça, vai pro próximo domingo 06:00 UTC', () => {
    expect(proximoBackup(new Date('2026-10-06T12:00:00Z')).toISOString()).toBe('2026-10-11T06:00:00.000Z');
  });
  it('no domingo antes das 06:00 UTC, é hoje', () => {
    expect(proximoBackup(new Date('2026-10-11T05:59:00Z')).toISOString()).toBe('2026-10-11T06:00:00.000Z');
  });
  it('no domingo a partir das 06:00 UTC, é o domingo seguinte', () => {
    expect(proximoBackup(new Date('2026-10-11T06:00:00Z')).toISOString()).toBe('2026-10-18T06:00:00.000Z');
    expect(proximoBackup(new Date('2026-10-11T20:00:00Z')).toISOString()).toBe('2026-10-18T06:00:00.000Z');
  });
  it('atravessa virada de mês e de ano', () => {
    expect(proximoBackup(new Date('2026-12-30T10:00:00Z')).toISOString()).toBe('2027-01-03T06:00:00.000Z');
  });
});

describe('gravaMensal / limpaImagens', () => {
  it('mensal só no primeiro domingo do mês', () => {
    expect(gravaMensal(new Date('2026-10-04T06:00:00Z'))).toBe(true);
    expect(gravaMensal(new Date('2026-10-11T06:00:00Z'))).toBe(false);
  });
  it('limpeza só em janeiro e julho, no primeiro domingo', () => {
    expect(limpaImagens(new Date('2027-01-03T06:00:00Z'))).toBe(true);
    expect(limpaImagens(new Date('2026-07-05T06:00:00Z'))).toBe(true);
    expect(limpaImagens(new Date('2026-07-12T06:00:00Z'))).toBe(false);
    expect(limpaImagens(new Date('2026-10-04T06:00:00Z'))).toBe(false);
  });
});

describe('backupAtrasado', () => {
  const agora = new Date('2026-10-20T00:00:00Z');
  it('em dia dentro de 8 dias, atrasado depois', () => {
    expect(backupAtrasado('2026-10-13T06:00:00Z', agora)).toBe(false);
    expect(backupAtrasado('2026-10-11T06:00:00Z', agora)).toBe(true);
  });
});
