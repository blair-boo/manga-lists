import { describe, expect, it } from 'vitest';
import { tokenSortRatio } from './tokenSortRatio';

describe('tokenSortRatio', () => {
  it('títulos idênticos dão score 1', () => {
    expect(tokenSortRatio('Solo Leveling', 'Solo Leveling')).toBe(1);
  });

  it('ignora acento/caixa/pontuação (mesma normalização de normalizarTitulo)', () => {
    expect(tokenSortRatio('Re:Zero', 're zero')).toBe(1);
  });

  it('ignora a ordem das palavras', () => {
    expect(tokenSortRatio('Forgotten Field, The', 'The Forgotten Field')).toBe(1);
  });

  it('títulos completamente diferentes dão score baixo', () => {
    expect(tokenSortRatio('Solo Leveling', 'Omniscient Reader')).toBeLessThan(0.4);
  });

  it('títulos parecidos mas não idênticos ficam numa faixa intermediária', () => {
    const score = tokenSortRatio('If It’s Remorse You Desire', 'If It’s Remorse You Desire [Full ver.]');
    expect(score).toBeGreaterThan(0.7);
    expect(score).toBeLessThan(1);
  });
});
