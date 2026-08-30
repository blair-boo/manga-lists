import { beforeEach, describe, expect, it, vi } from 'vitest';

// `repo.ts` importa `syncNow` de ../sync/sync, que carrega o supabaseClient e
// esse lança no import quando VITE_SUPABASE_URL/ANON_KEY não existem. O mock
// (içado pelo vitest antes dos imports) corta a cadeia e, de quebra, garante
// que nenhum teste tente falar com a rede.
vi.mock('../sync/sync', () => ({ syncNow: vi.fn(() => Promise.resolve()) }));

const { createFonte, createObra, updateFonte, deleteFonte } = await import('./repo');
const { db } = await import('./localDb');
import type { NovaFonte, NovaObra } from './repo';

function novaObra(over: Partial<NovaObra> = {}): NovaObra {
  return {
    tipo: 'Manhwa',
    titulo: 'Obra de teste',
    titulos_alternativos: null,
    autor: null,
    artistas: null,
    capa_url: null,
    capitulo_atual: null,
    status_leitura: null,
    status_publicacao: null,
    status_publicacao_manual: false,
    fim_de_temporada: false,
    ultimo_capitulo_lancado: null,
    ultimo_capitulo_via_scraper: false,
    score: null,
    generos: null,
    tags: null,
    observacoes: null,
    obra_vinculada_id: null,
    classificacao: null,
    novelupdates_url: null,
    anilist_url: null,
    myanimelist_url: null,
    mangaupdates_url: null,
    mangadex_url: null,
    mangabaka_url: null,
    pdf: false,
    favorito: false,
    ...over,
  };
}

function novaFonte(obraId: string, over: Partial<NovaFonte> = {}): NovaFonte {
  return {
    obra_id: obraId,
    site: 'comix.to',
    url: 'https://comix.to/title/abc-obra-de-teste',
    ultimo_capitulo_detectado: null,
    atualizado_por_scraper: false,
    confiavel: true,
    status_aprovacao: 'aprovado',
    descoberta_automaticamente: false,
    ultima_verificacao: null,
    tipo_detectado: 'manga',
    tipo_manual: false,
    ordem: 0,
    ...over,
  };
}

beforeEach(async () => {
  await Promise.all([db.obras.clear(), db.fontes.clear(), db.syncQueue.clear()]);
});

describe('updateFonte — origem do capítulo', () => {
  it('marca como manual quando só o capítulo é passado', async () => {
    // Edição digitada na tela da obra: não diz de onde veio o número, então
    // vale o padrão (manual).
    const obra = await createObra(novaObra());
    const fonte = await createFonte(novaFonte(obra.id, { atualizado_por_scraper: true }));

    await updateFonte(fonte.id, { ultimo_capitulo_detectado: 50 });

    expect((await db.fontes.get(fonte.id))?.atualizado_por_scraper).toBe(false);
  });

  it('respeita atualizado_por_scraper quando passado explicitamente', async () => {
    // É o caso da importação do comix: o número vem do `latestChapter` da
    // página, não de digitação. Antes o `true` era sobrescrito por `false`.
    const obra = await createObra(novaObra());
    const fonte = await createFonte(novaFonte(obra.id));

    await updateFonte(fonte.id, {
      ultimo_capitulo_detectado: 167,
      atualizado_por_scraper: true,
    });

    const salva = await db.fontes.get(fonte.id);
    expect(salva?.atualizado_por_scraper).toBe(true);
    expect(salva?.ultimo_capitulo_detectado).toBe(167);
  });

  it('respeita um false explícito também', async () => {
    const obra = await createObra(novaObra());
    const fonte = await createFonte(novaFonte(obra.id, { atualizado_por_scraper: true }));

    await updateFonte(fonte.id, {
      ultimo_capitulo_detectado: 12,
      atualizado_por_scraper: false,
    });

    expect((await db.fontes.get(fonte.id))?.atualizado_por_scraper).toBe(false);
  });

  it('não mexe na origem quando o capítulo não está no patch', async () => {
    // Reordenar ou aprovar uma fonte não pode reclassificar o capítulo dela.
    const obra = await createObra(novaObra());
    const fonte = await createFonte(
      novaFonte(obra.id, { ultimo_capitulo_detectado: 30, atualizado_por_scraper: true })
    );

    await updateFonte(fonte.id, { ordem: 3 });

    expect((await db.fontes.get(fonte.id))?.atualizado_por_scraper).toBe(true);
  });
});

describe('updateFonte — recálculo do capítulo da obra', () => {
  it('leva o maior capítulo das fontes aprovadas pra obra', async () => {
    const obra = await createObra(novaObra());
    const a = await createFonte(novaFonte(obra.id, { url: 'https://comix.to/title/a' }));
    await createFonte(
      novaFonte(obra.id, { url: 'https://outro.site/b', site: 'outro.site', ultimo_capitulo_detectado: 90 })
    );

    await updateFonte(a.id, { ultimo_capitulo_detectado: 167, atualizado_por_scraper: true });

    const atualizada = await db.obras.get(obra.id);
    expect(atualizada?.ultimo_capitulo_lancado).toBe(167);
    // O maior veio de fonte externa -> a obra conta como confirmada.
    expect(atualizada?.ultimo_capitulo_via_scraper).toBe(true);
  });

  it('não marca via_scraper quando o maior capítulo é manual', async () => {
    const obra = await createObra(novaObra());
    const externa = await createFonte(novaFonte(obra.id, { url: 'https://comix.to/title/a' }));
    const manual = await createFonte(
      novaFonte(obra.id, { url: 'https://outro.site/b', site: 'outro.site' })
    );

    await updateFonte(externa.id, { ultimo_capitulo_detectado: 100, atualizado_por_scraper: true });
    await updateFonte(manual.id, { ultimo_capitulo_detectado: 200 });

    const atualizada = await db.obras.get(obra.id);
    expect(atualizada?.ultimo_capitulo_lancado).toBe(200);
    expect(atualizada?.ultimo_capitulo_via_scraper).toBe(false);
  });

  it('ignora fontes não aprovadas no recálculo', async () => {
    const obra = await createObra(novaObra());
    const aprovada = await createFonte(novaFonte(obra.id, { url: 'https://comix.to/title/a' }));
    await createFonte(
      novaFonte(obra.id, {
        url: 'https://pendente.site/b',
        site: 'pendente.site',
        status_aprovacao: 'pendente',
        ultimo_capitulo_detectado: 999,
      })
    );

    await updateFonte(aprovada.id, { ultimo_capitulo_detectado: 42, atualizado_por_scraper: true });

    expect((await db.obras.get(obra.id))?.ultimo_capitulo_lancado).toBe(42);
  });

  it('volta a obra pra null quando a última fonte com capítulo é removida', async () => {
    const obra = await createObra(novaObra());
    const fonte = await createFonte(novaFonte(obra.id));
    await updateFonte(fonte.id, { ultimo_capitulo_detectado: 77, atualizado_por_scraper: true });
    expect((await db.obras.get(obra.id))?.ultimo_capitulo_lancado).toBe(77);

    await deleteFonte(fonte.id);

    const atualizada = await db.obras.get(obra.id);
    expect(atualizada?.ultimo_capitulo_lancado).toBeNull();
    expect(atualizada?.ultimo_capitulo_via_scraper).toBe(false);
  });
});

describe('updateFonte — fila de sincronização', () => {
  it('enfileira o payload já com a origem resolvida', async () => {
    // O que sobe pro Supabase é a linha inteira depois da regra, não o patch
    // cru — se a fila levasse o `changes`, o servidor veria outra coisa.
    const obra = await createObra(novaObra());
    const fonte = await createFonte(novaFonte(obra.id));
    await db.syncQueue.clear();

    await updateFonte(fonte.id, { ultimo_capitulo_detectado: 167, atualizado_por_scraper: true });

    const [item] = await db.syncQueue.where('entity').equals('fontes').toArray();
    expect(item.op).toBe('update');
    expect(item.recordId).toBe(fonte.id);
    expect((item.payload as { atualizado_por_scraper: boolean }).atualizado_por_scraper).toBe(true);
  });
});
