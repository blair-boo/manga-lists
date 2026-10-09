import { beforeEach, describe, expect, it, vi } from 'vitest';

// Servidor falso em memória, com latência por chamada, pra reproduzir corridas
// entre o ciclo de sync e escritas locais (criar obra + fonte durante um sync).
type Row = Record<string, unknown> & { id: string };
const servidor: Record<string, Row[]> = { obras: [], fontes: [], listas: [], reader_obras: [], reader_fontes: [], reader_capitulos: [] };
vi.stubGlobal('navigator', { onLine: true });
const atraso = () => new Promise((r) => setTimeout(r, 5));

vi.mock('../lib/supabaseClient', () => {
  function from(tabela: string) {
    let filtroGt: string | null = null;
    let colunas = '*';
    let faixa: [number, number] = [0, 999];
    const q: Record<string, unknown> = {
      select(c: string) { colunas = c; return q; },
      order() { return q; },
      range(a: number, b: number) { faixa = [a, b]; return q; },
      gt(_c: string, v: string) { filtroGt = v; return q; },
      eq() { return q; },
      delete() { return { eq: async (_c: string, id: string) => { await atraso(); servidor[tabela] = servidor[tabela].filter((r) => r.id !== id); return { error: null }; } }; },
      async upsert(payload: Row) {
        await atraso();
        const i = servidor[tabela].findIndex((r) => r.id === payload.id);
        if (i >= 0) servidor[tabela][i] = { ...servidor[tabela][i], ...payload };
        else servidor[tabela].push({ ...payload });
        return { error: null };
      },
      then(res: (v: unknown) => unknown) {
        return atraso().then(() => {
          let rows = servidor[tabela];
          if (filtroGt) rows = rows.filter((r) => String(r.atualizado_em) > filtroGt!);
          rows = rows.slice(faixa[0], faixa[1] + 1);
          if (colunas === 'id') rows = rows.map((r) => ({ id: r.id }));
          return { data: rows.map((r) => ({ ...r })), error: null };
        }).then(res);
      },
    };
    return q;
  }
  return { supabase: { from } };
});

const { createObra, createFonte, criarObraComFontes } = await import('../db/repo');
const { db } = await import('../db/localDb');
const { syncNow, hardSync, comLimiteDeTempo } = await import('./sync');

const obraBase = {
  tipo: 'Manhwa', titulo: 'T', titulos_alternativos: null, autor: null, artistas: null, capa_url: null,
  capitulo_atual: null, status_leitura: null, status_publicacao: null, status_publicacao_manual: false,
  fim_de_temporada: false, ultimo_capitulo_lancado: null, ultimo_capitulo_via_scraper: false, score: null,
  generos: null, tags: null, observacoes: null, obra_vinculada_id: null, classificacao: null,
  novelupdates_url: null, anilist_url: null, myanimelist_url: null, mangaupdates_url: null,
  mangadex_url: null, mangabaka_url: null, pdf: false, favorito: false, nostalgic: false,
} as const;

const fonteBase = (obraId: string, url: string) => ({
  obra_id: obraId, site: 'comix.to', url, ultimo_capitulo_detectado: null, atualizado_por_scraper: false,
  confiavel: true, status_aprovacao: 'aprovado' as const, descoberta_automaticamente: false,
  ultima_verificacao: null, tipo_detectado: 'manga' as const, tipo_manual: false, ordem: 0,
});

async function esperar(cond: () => Promise<boolean>, ms = 3000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

beforeEach(async () => {
  for (const k of Object.keys(servidor)) servidor[k] = [];
  await Promise.all([
    db.obras.clear(), db.fontes.clear(), db.syncQueue.clear(), db.meta.clear(), db.listas.clear(),
    db.reader_obras.clear(), db.reader_fontes.clear(), db.reader_capitulos.clear(),
  ]);
});

describe('sync x escrita local concorrente', () => {
  it('obra + fonte criadas durante um ciclo em andamento chegam ao servidor e permanecem locais', async () => {
    const ciclo = syncNow(); // ciclo já rodando
    await new Promise((r) => setTimeout(r, 12));
    const obra = await createObra({ ...obraBase }, true);
    await new Promise((r) => setTimeout(r, 20));
    await createFonte(fonteBase(obra.id, 'https://comix.to/title/x'), true);

    await ciclo;
    const ok = await esperar(async () => servidor.fontes.length === 1 && (await db.syncQueue.count()) === 0);
    expect(ok).toBe(true);
    expect(await db.fontes.count()).toBe(1);
  });

  it('varia o ponto de entrada da escrita em relação ao ciclo (varredura de timing)', async () => {
    for (let atrasoMs = 0; atrasoMs <= 80; atrasoMs += 8) {
      for (const k of Object.keys(servidor)) servidor[k] = [];
      await Promise.all([db.obras.clear(), db.fontes.clear(), db.syncQueue.clear(), db.meta.clear()]);
      for (let i = 0; i < 1100; i++) servidor.fontes.push({ id: `f${i}`, obra_id: 'zz', url: `u${i}` });

      const ciclo = syncNow();
      await new Promise((r) => setTimeout(r, atrasoMs));
      const { obra } = await criarObraComFontes({ ...obraBase, titulo: `T${atrasoMs}` }, ['https://comix.to/title/a']);
      await ciclo;
      const ok = await esperar(
        async () => servidor.fontes.some((f) => f.obra_id === obra.id) && (await db.syncQueue.count()) === 0,
        4000
      );
      expect(ok, `atraso ${atrasoMs}ms: fonte não chegou ao servidor`).toBe(true);
      await esperar(async () => !(await syncNow()).error, 1000);
      expect(await db.fontes.where('obra_id').equals(obra.id).count(), `atraso ${atrasoMs}ms: fonte sumiu local`).toBe(1);
    }
  }, 60_000);

  it('pull de fontes não apaga fonte local ainda não enviada e remove a que sumiu do servidor', async () => {
    servidor.fontes.push({ id: 'a', obra_id: 'o', url: 'a' }, { id: 'b', obra_id: 'o', url: 'b' });
    await syncNow();
    expect(await db.fontes.count()).toBe(2);

    await db.fontes.put({ ...fonteBase('o', 'local'), id: 'nova', criado_em: 'x' });
    await db.syncQueue.add({ entity: 'fontes', op: 'insert', recordId: 'nova', payload: null as never, createdAt: 'x' });
    servidor.fontes = servidor.fontes.filter((f) => f.id !== 'b');
    // push da 'nova' falha de propósito: payload nulo não é enviado como linha válida
    await syncNow();
    const ids = (await db.fontes.toCollection().primaryKeys()).sort();
    expect(ids).toEqual(['a', 'nova']);
  });

  it('hardSync re-baixa linha defasada, preserva pendência local e a fila', async () => {
    servidor.obras.push(
      { id: 'o1', titulo: 'novo', atualizado_em: '2026-01-01T00:00:00Z' },
      { id: 'o2', titulo: 'server', atualizado_em: '2026-01-01T00:00:00Z' }
    );
    await syncNow();
    // local fica defasado SEM o servidor mudar atualizado_em: o incremental nunca corrige
    await db.obras.update('o1', { titulo: 'defasado' });
    await syncNow();
    expect((await db.obras.get('o1'))?.titulo).toBe('defasado');

    // o2 tem edição local pendente (push nulo não chega ao servidor)
    await db.obras.update('o2', { titulo: 'editado local' });
    await db.syncQueue.add({ entity: 'obras', op: 'update', recordId: 'o2', payload: null as never, createdAt: 'x' });

    const r = await hardSync();
    expect(r.ok).toBe(false); // pendência não enviada reporta falha, mas o pull rodou
    expect((await db.obras.get('o1'))?.titulo).toBe('novo');
    expect((await db.obras.get('o2'))?.titulo).toBe('editado local');
    expect(await db.syncQueue.count()).toBe(1);
  });

  it('hardSync remove capítulo do Reader apagado no servidor, mantém pendente e não apaga com resposta vazia', async () => {
    servidor.reader_capitulos.push(
      { id: 'c1', atualizado_em: '2026-01-01T00:00:00Z' },
      { id: 'c2', atualizado_em: '2026-01-01T00:00:00Z' }
    );
    await syncNow();
    expect(await db.reader_capitulos.count()).toBe(2);

    await db.reader_capitulos.put({ id: 'local', atualizado_em: 'x' } as never);
    await db.reader_capitulos.put({ id: 'pend', atualizado_em: 'x' } as never);
    await db.syncQueue.add({ entity: 'reader_capitulos', op: 'insert', recordId: 'pend', payload: null as never, createdAt: 'x' });
    servidor.reader_capitulos = servidor.reader_capitulos.filter((c) => c.id !== 'c2');

    await hardSync();
    const ids = (await db.reader_capitulos.toCollection().primaryKeys()).sort();
    expect(ids).toEqual(['c1', 'pend']);

    servidor.reader_capitulos = [];
    await hardSync();
    expect(await db.reader_capitulos.count()).toBeGreaterThan(0);
  });

  it('ciclo que nunca responde é liberado pelo limite de tempo', async () => {
    const r = await comLimiteDeTempo(new Promise(() => {}), 20);
    expect(r.ok).toBe(false);
    expect(await comLimiteDeTempo(Promise.resolve({ ok: true }), 20)).toEqual({ ok: true });
  });
});
