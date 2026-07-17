import { describe, expect, it } from 'vitest';
import { mensagemDeErro } from './erros';

describe('mensagemDeErro', () => {
  it('usa a message de um Error', () => {
    expect(mensagemDeErro(new Error('deu ruim'))).toBe('deu ruim');
  });

  it('retorna strings como estão', () => {
    expect(mensagemDeErro('falha simples')).toBe('falha simples');
  });

  it('extrai message de um objeto plano tipo PostgrestError', () => {
    const pgError = {
      message: 'duplicate key value violates unique constraint',
      details: 'Key (id) already exists.',
      hint: null,
      code: '23505',
    };
    expect(mensagemDeErro(pgError)).toBe('duplicate key value violates unique constraint');
  });

  it('cai para error_description/error/details/hint nessa ordem', () => {
    expect(mensagemDeErro({ error_description: 'token expirado' })).toBe('token expirado');
    expect(mensagemDeErro({ error: 'invalid_grant' })).toBe('invalid_grant');
    expect(mensagemDeErro({ details: 'só o detalhe' })).toBe('só o detalhe');
    expect(mensagemDeErro({ hint: 'só a dica' })).toBe('só a dica');
  });

  it('ignora campos vazios/não-string e usa o próximo da lista', () => {
    expect(mensagemDeErro({ message: '   ', error: 'de verdade' })).toBe('de verdade');
    expect(mensagemDeErro({ message: 42, error: 'de verdade' })).toBe('de verdade');
  });

  it('serializa objeto sem nenhum campo conhecido (nunca "[object Object]")', () => {
    const resultado = mensagemDeErro({ status: 500, ok: false });
    expect(resultado).toBe('{"status":500,"ok":false}');
    expect(resultado).not.toContain('[object Object]');
  });

  it('cobre null, undefined e números via fallback', () => {
    expect(mensagemDeErro(null)).toBe('null');
    expect(mensagemDeErro(undefined)).toBe('undefined');
    expect(mensagemDeErro(404)).toBe('404');
  });
});
