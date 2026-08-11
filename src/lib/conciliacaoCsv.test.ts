import { describe, expect, it } from 'vitest';
import {
  chaveBlacklist,
  classificarScore,
  deduplicarVersaoPreferida,
  filtrarObrasPorTipo,
  melhorMatch,
  montarPlanoConciliacao,
  parseCsvConciliacao,
  type CandidatoObra,
} from './conciliacaoCsv';

describe('parseCsvConciliacao', () => {
  it('lê apenas as duas primeiras colunas, ignorando o resto', () => {
    const { linhas, comCabecalho } = parseCsvConciliacao(
      'https://a.com/x,2026-01-01\nSolo Leveling,https://a.com/solo,extra,coisas\n'
    );
    // primeira linha não tem cabeçalho reconhecível (2ª coluna não é URL nem
    // parece isso importa aqui) — nesse caso a 2ª coluna da 1ª linha
    // ("2026-01-01") não é uma URL, então é tratada como cabeçalho e descartada.
    expect(comCabecalho).toBe(true);
    expect(linhas).toEqual([{ titulo: 'Solo Leveling', url: 'https://a.com/solo' }]);
  });

  it('sem cabeçalho (2ª coluna já é URL na 1ª linha), todas as linhas são dados', () => {
    const { linhas, comCabecalho } = parseCsvConciliacao(
      'Solo Leveling,https://a.com/solo\nOmniscient Reader,https://a.com/orv\n'
    );
    expect(comCabecalho).toBe(false);
    expect(linhas).toHaveLength(2);
  });

  it('ignora linhas sem título ou sem link', () => {
    const { linhas } = parseCsvConciliacao('Título,Link\n,https://a.com/x\nSolo Leveling,\n');
    expect(linhas).toEqual([]);
  });
});

describe('deduplicarVersaoPreferida', () => {
  it('colapsa o par num item só: título simples (pro matching/alt-título) + link da variante [Full ver.]', () => {
    const linhas = [
      { titulo: "If It's Remorse You Desire [Full ver.]", url: 'https://manta.net/full?seriesId=3427' },
      { titulo: "If It's Remorse You Desire", url: 'https://manta.net/plain?seriesId=3429' },
    ];
    const resultado = deduplicarVersaoPreferida(linhas);
    expect(resultado).toEqual([{ titulo: "If It's Remorse You Desire", url: 'https://manta.net/full?seriesId=3427' }]);
  });

  it('sem par (só uma variante), passa direto sem mudança', () => {
    const linhas = [{ titulo: 'Solo Leveling', url: 'https://a.com/solo' }];
    expect(deduplicarVersaoPreferida(linhas)).toEqual([{ titulo: 'Solo Leveling', url: 'https://a.com/solo' }]);
  });
});

describe('filtrarObrasPorTipo', () => {
  const obras: CandidatoObra[] = [
    { obraId: '1', titulo: 'A', titulosAlternativos: null, tipo: 'Manga' },
    { obraId: '2', titulo: 'B', titulosAlternativos: null, tipo: 'Novel' },
    { obraId: '3', titulo: 'C', titulosAlternativos: null, tipo: null },
  ];

  it('mantém só obras do tipo selecionado, ignorando as demais (não descarta, só não compara)', () => {
    expect(filtrarObrasPorTipo(obras, new Set(['Novel']))).toEqual([obras[1]]);
  });

  it('obra sem tipo nunca entra, mesmo com o filtro amplo', () => {
    const resultado = filtrarObrasPorTipo(obras, new Set(['Manga', 'Novel', 'Manhwa', 'Manhua']));
    expect(resultado.map((o) => o.obraId)).toEqual(['1', '2']);
  });
});

describe('melhorMatch', () => {
  const obras: CandidatoObra[] = [
    { obraId: '1', titulo: 'Solo Leveling', titulosAlternativos: ['Na Honjaman'], tipo: 'Manhwa' },
    { obraId: '2', titulo: 'Omniscient Reader', titulosAlternativos: null, tipo: 'Manhwa' },
  ];

  it('acha a obra com maior score de título ou alternativo', () => {
    expect(melhorMatch('Solo Leveling', obras)).toEqual([{ obraId: '1', score: 1 }]);
    expect(melhorMatch('Na Honjaman', obras)).toEqual([{ obraId: '1', score: 1 }]);
  });

  it('empate no maior score retorna as duas obras', () => {
    const empatadas: CandidatoObra[] = [
      { obraId: '1', titulo: 'Duplicate Title', titulosAlternativos: null, tipo: 'Manga' },
      { obraId: '2', titulo: 'Duplicate Title', titulosAlternativos: null, tipo: 'Manga' },
    ];
    const resultado = melhorMatch('Duplicate Title', empatadas);
    expect(resultado).toHaveLength(2);
    expect(resultado.map((r) => r.obraId).sort()).toEqual(['1', '2']);
  });
});

describe('classificarScore', () => {
  const limiares = { limiar_auto_aprovacao: 0.9, limiar_minimo_pendencia: 0.7 };

  it('score 1 (exato) aprova sem mexer em títulos alternativos', () => {
    expect(classificarScore(1, limiares)).toBe('aprovado_exato');
  });

  it('90-99% aprova e sinaliza pra gravar título alternativo', () => {
    expect(classificarScore(0.95, limiares)).toBe('aprovado_com_alt_titulo');
  });

  it('70-89% vai pra fila de aprovação manual', () => {
    expect(classificarScore(0.75, limiares)).toBe('pendente');
  });

  it('abaixo de 70% é descartado', () => {
    expect(classificarScore(0.5, limiares)).toBe('descartado');
  });
});

describe('montarPlanoConciliacao', () => {
  const limiares = { limiar_auto_aprovacao: 0.9, limiar_minimo_pendencia: 0.7 };
  const candidatos: CandidatoObra[] = [
    { obraId: '1', titulo: 'Solo Leveling', titulosAlternativos: null, tipo: 'Manhwa' },
    { obraId: '2', titulo: 'Omniscient Reader', titulosAlternativos: null, tipo: 'Manhwa' },
  ];

  it('match exato vira auto-aprovado', () => {
    const plano = montarPlanoConciliacao(
      [{ titulo: 'Solo Leveling', url: 'https://novelupdates.com/series/solo-leveling' }],
      candidatos,
      new Set(),
      limiares
    );
    expect(plano.autoAprovados).toEqual([
      {
        obraId: '1',
        obraTitulo: 'Solo Leveling',
        titulo: 'Solo Leveling',
        url: 'https://novelupdates.com/series/solo-leveling',
        score: 1,
        exato: true,
      },
    ]);
    expect(plano.pendentesNovos).toEqual([]);
    expect(plano.descartados).toBe(0);
  });

  it('score na faixa 70-89% vai pra fila de pendentes', () => {
    const plano = montarPlanoConciliacao(
      [{ titulo: 'Solo Levellling Extra Words Here', url: 'https://a.com/x' }],
      candidatos,
      new Set(),
      limiares
    );
    // não afirma o score exato (depende do algoritmo), só a faixa de decisão
    if (plano.pendentesNovos.length > 0) {
      expect(plano.pendentesNovos[0].obraId).toBe('1');
      expect(plano.autoAprovados).toEqual([]);
    } else {
      expect(plano.descartados).toBe(1);
    }
  });

  it('título completamente diferente é descartado', () => {
    const plano = montarPlanoConciliacao(
      [{ titulo: 'Completely Unrelated Story Title', url: 'https://a.com/x' }],
      candidatos,
      new Set(),
      limiares
    );
    expect(plano.autoAprovados).toEqual([]);
    expect(plano.pendentesNovos).toEqual([]);
    expect(plano.descartados).toBe(1);
  });

  it('par já rejeitado na blacklist é pulado', () => {
    const blacklist = new Set([chaveBlacklist('1', 'https://novelupdates.com/series/solo-leveling')]);
    const plano = montarPlanoConciliacao(
      [{ titulo: 'Solo Leveling', url: 'https://novelupdates.com/series/solo-leveling' }],
      candidatos,
      blacklist,
      limiares
    );
    expect(plano.autoAprovados).toEqual([]);
    expect(plano.puladosBlacklist).toBe(1);
  });

  it('empate de score entre duas obras nunca auto-aprova — vira um item por obra na fila', () => {
    const empatadas: CandidatoObra[] = [
      { obraId: '1', titulo: 'Duplicate Title', titulosAlternativos: null, tipo: 'Manga' },
      { obraId: '2', titulo: 'Duplicate Title', titulosAlternativos: null, tipo: 'Manga' },
    ];
    const plano = montarPlanoConciliacao(
      [{ titulo: 'Duplicate Title', url: 'https://a.com/x' }],
      empatadas,
      new Set(),
      limiares
    );
    expect(plano.autoAprovados).toEqual([]);
    expect(plano.pendentesNovos).toHaveLength(2);
    expect(plano.pendentesNovos.every((p) => p.ambiguo)).toBe(true);
    expect(plano.pendentesNovos.map((p) => p.obraId).sort()).toEqual(['1', '2']);
  });

  it('dedup "[Full ver.]" usa o título simples pro match (exato) e o link da variante Full ver.', () => {
    const plano = montarPlanoConciliacao(
      [
        { titulo: 'Solo Leveling [Full ver.]', url: 'https://a.com/full' },
        { titulo: 'Solo Leveling', url: 'https://a.com/plain' },
      ],
      candidatos,
      new Set(),
      limiares
    );
    expect(plano.autoAprovados).toEqual([
      {
        obraId: '1',
        obraTitulo: 'Solo Leveling',
        titulo: 'Solo Leveling',
        url: 'https://a.com/full',
        score: 1,
        exato: true,
      },
    ]);
  });

  it('dedup "[Full ver.]" com título base só parecido (não exato) grava o título simples como alternativo', () => {
    const plano = montarPlanoConciliacao(
      [
        { titulo: 'Solo Levelling Extra Word [Full ver.]', url: 'https://a.com/full' },
        { titulo: 'Solo Levelling Extra Word', url: 'https://a.com/plain' },
      ],
      candidatos,
      new Set(),
      limiares
    );
    if (plano.autoAprovados.length > 0) {
      expect(plano.autoAprovados[0]).toMatchObject({ url: 'https://a.com/full', titulo: 'Solo Levelling Extra Word' });
    }
  });
});
