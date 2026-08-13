import { describe, expect, it } from 'vitest';
import {
  fontePreferida,
  fontesParaCapitulo,
  ordenarCapitulosReader,
  paywallLiberado,
  resumirReader,
  textoTraducao,
} from './reader';
import type { ReaderCapitulo, ReaderFonte, ReaderObra } from '../types';

const AGORA = new Date('2026-08-13T12:00:00Z');

function readerObraFake(parcial: Partial<ReaderObra> = {}): ReaderObra {
  return {
    id: 'r1',
    obra_id: 'o1',
    concluido: false,
    busca_manual: false,
    estado: 'aguardando',
    estado_em: '2026-08-01T00:00:00Z',
    ultima_busca_em: null,
    ultima_busca_ok: null,
    ultima_busca_mensagem: null,
    total_capitulos_site: null,
    total_side_stories_site: null,
    info_titulo: null,
    info_autor: null,
    info_score: null,
    info_status: null,
    info_link: null,
    info_sinopse: null,
    info_generos: null,
    info_tags: null,
    espelhar: {},
    pasta_storage: null,
    capa_path: null,
    epub_path: null,
    epub_gerado_em: null,
    epub_parcial_path: null,
    epub_parcial_gerado_em: null,
    pdf_path: null,
    pdf_gerado_em: null,
    criado_em: '2026-08-01T00:00:00Z',
    atualizado_em: '2026-08-01T00:00:00Z',
    ...parcial,
  };
}

function capituloFake(parcial: Partial<ReaderCapitulo> = {}): ReaderCapitulo {
  return {
    id: `c${Math.random()}`,
    reader_obra_id: 'r1',
    obra_id: 'o1',
    reader_fonte_id: null,
    numero: 1,
    numero_texto: null,
    titulo: null,
    side_story: false,
    ordem: 1,
    estado: 'descoberto',
    estado_em: '2026-08-01T00:00:00Z',
    disponivel_em: null,
    url: null,
    path_md: null,
    baixado_em: null,
    formatado_em: null,
    erro: null,
    erro_em: null,
    criado_em: '2026-08-01T00:00:00Z',
    atualizado_em: '2026-08-01T00:00:00Z',
    ...parcial,
  };
}

function fonteFake(parcial: Partial<ReaderFonte> = {}): ReaderFonte {
  return {
    id: `f${Math.random()}`,
    reader_obra_id: 'r1',
    grupo: 'Grupo',
    url_indice: null,
    url_base: null,
    de: null,
    ate: null,
    adaptador: null,
    preferida: false,
    ordem: null,
    ativa: true,
    criado_em: '2026-08-01T00:00:00Z',
    atualizado_em: '2026-08-01T00:00:00Z',
    ...parcial,
  };
}

describe('ordenarCapitulosReader', () => {
  it('ordena por ordem e joga os sem ordem pro fim', () => {
    const capitulos = [
      capituloFake({ id: 'sem', ordem: null }),
      capituloFake({ id: 'b', ordem: 2 }),
      capituloFake({ id: 'a', ordem: 1 }),
    ];
    expect(ordenarCapitulosReader(capitulos).map((c) => c.id)).toEqual(['a', 'b', 'sem']);
  });

  it('não ordena por numero — side story fora do eixo numérico fica no lugar certo', () => {
    const capitulos = [
      capituloFake({ id: 'ss', numero: 1, side_story: true, ordem: 300 }),
      capituloFake({ id: 'cap200', numero: 200, ordem: 200 }),
    ];
    expect(ordenarCapitulosReader(capitulos).map((c) => c.id)).toEqual(['cap200', 'ss']);
  });
});

describe('paywallLiberado', () => {
  it('trata como liberado quando a data já passou', () => {
    const cap = capituloFake({ estado: 'bloqueado', disponivel_em: '2026-08-01' });
    expect(paywallLiberado(cap, AGORA)).toBe(true);
  });

  it('trata como liberado no próprio dia da liberação', () => {
    const cap = capituloFake({ estado: 'bloqueado', disponivel_em: '2026-08-13' });
    expect(paywallLiberado(cap, AGORA)).toBe(true);
  });

  it('continua bloqueado quando a data é futura', () => {
    const cap = capituloFake({ estado: 'bloqueado', disponivel_em: '2026-09-03' });
    expect(paywallLiberado(cap, AGORA)).toBe(false);
  });

  it('continua bloqueado quando não há data conhecida', () => {
    const cap = capituloFake({ estado: 'bloqueado', disponivel_em: null });
    expect(paywallLiberado(cap, AGORA)).toBe(false);
  });
});

describe('resumirReader', () => {
  it('sem capítulos fica aguardando e zera as contagens', () => {
    const resumo = resumirReader(readerObraFake(), [], AGORA);
    expect(resumo.estado).toBe('aguardando');
    expect(resumo.baixados).toBe(0);
    expect(resumo.total).toBe(0);
    expect(resumo.ultimoBaixado).toBeNull();
  });

  it('conta como baixado tudo que já tem texto no storage', () => {
    const resumo = resumirReader(
      readerObraFake(),
      [
        capituloFake({ ordem: 1, estado: 'publicado' }),
        capituloFake({ ordem: 2, estado: 'formatado' }),
        capituloFake({ ordem: 3, estado: 'baixado' }),
        capituloFake({ ordem: 4, estado: 'descoberto' }),
      ],
      AGORA
    );
    expect(resumo.baixados).toBe(3);
    expect(resumo.total).toBe(4);
  });

  it('exclui side stories do total e conta separado', () => {
    const resumo = resumirReader(
      readerObraFake(),
      [
        capituloFake({ ordem: 1, estado: 'publicado' }),
        capituloFake({ ordem: 2, estado: 'publicado', side_story: true }),
      ],
      AGORA
    );
    expect(resumo.total).toBe(1);
    expect(resumo.sideStories).toBe(1);
  });

  it('usa o total declarado pelo site quando existe', () => {
    const resumo = resumirReader(
      readerObraFake({ total_capitulos_site: 210 }),
      [capituloFake({ ordem: 1, estado: 'publicado' })],
      AGORA
    );
    expect(resumo.total).toBe(210);
  });

  it('último baixado é o de maior ordem, não o mais recente no tempo', () => {
    const resumo = resumirReader(
      readerObraFake(),
      [
        capituloFake({ id: 'alto', ordem: 10, estado: 'publicado' }),
        capituloFake({ id: 'baixo', ordem: 2, estado: 'publicado' }),
      ],
      AGORA
    );
    expect(resumo.ultimoBaixado?.id).toBe('alto');
  });

  it('acende disponivel quando há capítulo esperando decisão', () => {
    const resumo = resumirReader(readerObraFake(), [capituloFake({ estado: 'descoberto' })], AGORA);
    expect(resumo.estado).toBe('disponivel');
    expect(resumo.aguardandoDecisao).toHaveLength(1);
  });

  it('capítulo com paywall vencido conta como esperando decisão, não como bloqueado', () => {
    const resumo = resumirReader(
      readerObraFake(),
      [capituloFake({ estado: 'bloqueado', disponivel_em: '2026-08-01' })],
      AGORA
    );
    expect(resumo.estado).toBe('disponivel');
    expect(resumo.aguardandoDecisao).toHaveLength(1);
    expect(resumo.proximosDisponiveis).toHaveLength(0);
  });

  it('lista os bloqueados futuros por data de liberação', () => {
    const resumo = resumirReader(
      readerObraFake(),
      [
        capituloFake({ id: 'tarde', ordem: 2, estado: 'bloqueado', disponivel_em: '2026-09-20' }),
        capituloFake({ id: 'cedo', ordem: 1, estado: 'bloqueado', disponivel_em: '2026-09-03' }),
      ],
      AGORA
    );
    expect(resumo.proximosDisponiveis.map((c) => c.id)).toEqual(['cedo', 'tarde']);
    // Só bloqueados não conta como "novidade pra baixar" — a obra segue aguardando.
    expect(resumo.estado).toBe('aguardando');
  });

  it('fica pronto quando todos os capítulos estão publicados', () => {
    const resumo = resumirReader(
      readerObraFake(),
      [capituloFake({ ordem: 1, estado: 'publicado' }), capituloFake({ ordem: 2, estado: 'publicado' })],
      AGORA
    );
    expect(resumo.estado).toBe('pronto');
  });

  it('capítulo baixado e não formatado põe a obra em formatando', () => {
    const resumo = resumirReader(readerObraFake(), [capituloFake({ estado: 'baixado' })], AGORA);
    expect(resumo.estado).toBe('formatando');
  });

  it('o toggle manual acende buscando', () => {
    const resumo = resumirReader(readerObraFake({ busca_manual: true }), [], AGORA);
    expect(resumo.estado).toBe('buscando');
  });

  it('confia no baixando gravado enquanto o job pode estar vivo', () => {
    const resumo = resumirReader(
      readerObraFake({ estado: 'baixando', estado_em: '2026-08-13T11:30:00Z' }),
      [capituloFake({ estado: 'descoberto' })],
      AGORA
    );
    expect(resumo.estado).toBe('baixando');
  });

  it('descarta o baixando gravado quando o job claramente morreu', () => {
    // Mesmo problema que scraper_runs teve com runs presas em 'rodando'.
    const resumo = resumirReader(
      readerObraFake({ estado: 'baixando', estado_em: '2026-08-10T00:00:00Z' }),
      [capituloFake({ estado: 'descoberto' })],
      AGORA
    );
    expect(resumo.estado).toBe('disponivel');
  });

  it('formatando vem dos capítulos, não da coluna — não envelhece', () => {
    const resumo = resumirReader(
      readerObraFake({ estado: 'formatando', estado_em: '2026-01-01T00:00:00Z' }),
      [],
      AGORA
    );
    expect(resumo.estado).toBe('aguardando');
  });
});

describe('fontesParaCapitulo', () => {
  const eternalune = fonteFake({ grupo: 'Eternalune', de: 1, ate: 150 });
  const novelupdates = fonteFake({ grupo: 'Novelupdates', de: 151, ate: null, preferida: true });

  it('escolhe pela faixa', () => {
    expect(fontesParaCapitulo([eternalune, novelupdates], 42).map((f) => f.grupo)).toEqual(['Eternalune']);
  });

  it('faixa aberta cobre qualquer número acima do início', () => {
    expect(fontesParaCapitulo([eternalune, novelupdates], 9999).map((f) => f.grupo)).toEqual(['Novelupdates']);
  });

  it('faixas sobrepostas devolvem as duas, com a preferida na frente', () => {
    const outra = fonteFake({ grupo: 'Outro', de: 1, ate: 200 });
    const preferida = fonteFake({ grupo: 'Preferida', de: 1, ate: 200, preferida: true });
    expect(fontesParaCapitulo([outra, preferida], 50).map((f) => f.grupo)).toEqual(['Preferida', 'Outro']);
  });

  it('ignora fontes inativas', () => {
    const inativa = fonteFake({ grupo: 'Morta', de: 1, ate: 150, ativa: false });
    expect(fontesParaCapitulo([inativa], 42)).toHaveLength(0);
  });
});

describe('fontePreferida', () => {
  it('devolve a marcada como preferida', () => {
    const fontes = [fonteFake({ grupo: 'A', de: 1 }), fonteFake({ grupo: 'B', de: 2, preferida: true })];
    expect(fontePreferida(fontes)?.grupo).toBe('B');
  });

  it('sem preferida, cai na primeira ativa por ordem', () => {
    const fontes = [fonteFake({ grupo: 'B', de: 151 }), fonteFake({ grupo: 'A', de: 1 })];
    expect(fontePreferida(fontes)?.grupo).toBe('A');
  });

  it('devolve null quando não há fonte ativa', () => {
    expect(fontePreferida([fonteFake({ ativa: false })])).toBeNull();
  });
});

describe('textoTraducao', () => {
  it('monta o texto no formato da planilha, com X pra faixa aberta', () => {
    const fontes = [
      fonteFake({ grupo: 'Novelupdates', de: 151, ate: null, ordem: 2 }),
      fonteFake({ grupo: 'Eternalune', de: 1, ate: 150, ordem: 1 }),
    ];
    expect(textoTraducao(fontes)).toBe('1-150 Eternalune / 151-X Novelupdates');
  });

  it('assume início 1 quando a faixa não tem começo declarado', () => {
    expect(textoTraducao([fonteFake({ grupo: 'Só um', de: null, ate: null })])).toBe('1-X Só um');
  });

  it('devolve string vazia sem fontes', () => {
    expect(textoTraducao([])).toBe('');
  });
});
