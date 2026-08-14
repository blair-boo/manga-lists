import { supabase } from '../lib/supabaseClient';
import { db, getLastSyncedAt, setLastSyncedAt } from '../db/localDb';
import type {
  Fonte,
  ListaItem,
  Obra,
  ReaderCapitulo,
  ReaderFonte,
  ReaderObra,
  SyncEntity,
  SyncQueueItem,
} from '../types';

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

/**
 * Colunas reais de cada tabela, usadas pra sanitizar o payload antes do
 * upsert. Existem porque registros locais podem carregar campos legados que
 * já não existem no servidor (ex.: `nota`, renomeada pra `score` — quem
 * puxou a obra antes do rename guardou o payload com o nome antigo, e ele
 * fica preso no objeto local até uma pull completa substituir o registro).
 * O upsert falha (PGRST204 "column not found") se QUALQUER chave do payload
 * não bater com uma coluna real, então filtrar aqui é o que destrava a fila
 * sem depender de limpar cada registro local na mão.
 */
const COLUNAS_OBRAS = new Set<keyof Obra>([
  'id',
  'tipo',
  'titulo',
  'titulos_alternativos',
  'autor',
  'artistas',
  'capa_url',
  'capitulo_atual',
  'status_leitura',
  'status_publicacao',
  'status_publicacao_manual',
  'fim_de_temporada',
  'ultimo_capitulo_lancado',
  'ultimo_capitulo_via_scraper',
  'score',
  'generos',
  'tags',
  'observacoes',
  'obra_vinculada_id',
  'classificacao',
  'novelupdates_url',
  'anilist_url',
  'myanimelist_url',
  'mangaupdates_url',
  'mangadex_url',
  'mangabaka_url',
  'pdf',
  'favorito',
  'criado_em',
  'atualizado_em',
]);

const COLUNAS_FONTES = new Set<keyof Fonte>([
  'id',
  'obra_id',
  'site',
  'url',
  'ultimo_capitulo_detectado',
  'atualizado_por_scraper',
  'confiavel',
  'status_aprovacao',
  'descoberta_automaticamente',
  'ultima_verificacao',
  'criado_em',
  'tipo_detectado',
  'tipo_manual',
  'ordem',
]);

const COLUNAS_READER_OBRAS = new Set<keyof ReaderObra>([
  'id',
  'obra_id',
  'concluido',
  'busca_manual',
  'estado',
  'estado_em',
  'ultima_busca_em',
  'ultima_busca_ok',
  'ultima_busca_mensagem',
  'total_capitulos_site',
  'total_side_stories_site',
  'info_titulo',
  'info_autor',
  'info_score',
  'info_status',
  'info_link',
  'info_sinopse',
  'info_generos',
  'info_tags',
  'espelhar',
  'pasta_storage',
  'capa_path',
  'epub_path',
  'epub_gerado_em',
  'epub_parcial_path',
  'epub_parcial_gerado_em',
  'pdf_path',
  'pdf_gerado_em',
  'criado_em',
  'atualizado_em',
]);

const COLUNAS_READER_FONTES = new Set<keyof ReaderFonte>([
  'id',
  'reader_obra_id',
  'grupo',
  'url_indice',
  'url_base',
  'de',
  'ate',
  'adaptador',
  'preferida',
  'ordem',
  'ativa',
  'criado_em',
  'atualizado_em',
]);

const COLUNAS_READER_CAPITULOS = new Set<keyof ReaderCapitulo>([
  'id',
  'reader_obra_id',
  'obra_id',
  'reader_fonte_id',
  'chave',
  'id_externo',
  'numero',
  'numero_texto',
  'titulo',
  'side_story',
  'ordem',
  'estado',
  'estado_em',
  'disponivel_em',
  'url',
  'path_md',
  'baixado_em',
  'formatado_em',
  'erro',
  'erro_em',
  'criado_em',
  'atualizado_em',
]);

const COLUNAS_POR_ENTIDADE: Record<SyncEntity, ReadonlySet<string>> = {
  obras: COLUNAS_OBRAS as ReadonlySet<string>,
  fontes: COLUNAS_FONTES as ReadonlySet<string>,
  reader_obras: COLUNAS_READER_OBRAS as ReadonlySet<string>,
  reader_fontes: COLUNAS_READER_FONTES as ReadonlySet<string>,
  reader_capitulos: COLUNAS_READER_CAPITULOS as ReadonlySet<string>,
};

function sanitizarPayload(entity: SyncEntity, payload: Record<string, unknown>): Record<string, unknown> {
  const colunas = COLUNAS_POR_ENTIDADE[entity];
  return Object.fromEntries(Object.entries(payload).filter(([chave]) => colunas.has(chave)));
}

const TAMANHO_PAGINA = 1000;

/**
 * Busca TODAS as linhas de uma tabela, paginando em lotes de TAMANHO_PAGINA.
 * Uma query sem paginação (`select('*')` puro) é truncada silenciosamente
 * pelo limite padrão de linhas do PostgREST/Supabase quando a tabela passa
 * de ~1000 linhas — sem erro, só devolve menos linhas do que existem. Foi a
 * causa real de fontes "desaparecidas": `fontes` passou de 1000 linhas e
 * pullFontes() parou de enxergar as mais recentes em toda sincronização,
 * mesmo numa sessão nova (nada a ver com cache do PWA). `query` PRECISA vir
 * com `.order(...)` numa coluna estável (ver chamadas) — `.range()` é só
 * offset/limit, sem ORDER BY as páginas não são deterministicamente
 * complementares.
 */
async function buscarTudoPaginado<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const todas: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await query(from, from + TAMANHO_PAGINA - 1);
    if (error) throw error;
    const linhas = data ?? [];
    todas.push(...linhas);
    if (linhas.length < TAMANHO_PAGINA) break;
    from += TAMANHO_PAGINA;
  }
  return todas;
}

async function applyMutation(item: SyncQueueItem): Promise<void> {
  const table = item.entity;
  if (item.op === 'delete') {
    const { error } = await supabase.from(table).delete().eq('id', item.recordId);
    if (error) throw error;
    return;
  }
  // insert/update: local id já é o uuid definitivo, então upsert cobre os dois casos
  const payload = sanitizarPayload(table, item.payload as unknown as Record<string, unknown>);
  const { error } = await supabase.from(table).upsert(payload);
  if (error) throw error;
}

/**
 * Envia mutações pendentes da fila local para o Supabase, em ordem por
 * registro. Uma mutação que falha (ex.: uma linha com dado inválido) só pula
 * as mutações SEGUINTES do MESMO registro (pra não reenviar fora de ordem) —
 * não trava as de outros registros na fila. Sem isso, uma única linha
 * problemática de uma atualização em massa via CSV bloqueava o envio de
 * TODAS as outras linhas indefinidamente (a fila só reprocessa do início).
 * Retorna quantos registros ficaram com mutação pendente por causa de erro.
 */
export async function pushPending(): Promise<{ falhas: number }> {
  const pending = await db.syncQueue.orderBy('createdAt').toArray();
  const registrosComFalha = new Set<string>();
  for (const item of pending) {
    const chave = `${item.entity}:${item.recordId}`;
    if (registrosComFalha.has(chave)) continue;
    try {
      await applyMutation(item);
      if (item.id !== undefined) {
        await db.syncQueue.delete(item.id);
      }
    } catch (err) {
      console.warn('Falha ao sincronizar mutação pendente, tentando novamente depois', item, err);
      registrosComFalha.add(chave);
    }
  }
  return { falhas: registrosComFalha.size };
}

/**
 * Puxa de uma tabela as linhas alteradas no servidor desde a última sync
 * (incremental via `atualizado_em`). Só serve para tabelas que mantêm essa
 * coluna atualizada — em `obras` e nas três do Reader é um trigger no Postgres
 * (`set_atualizado_em`) que garante isso. `fontes` NÃO entra aqui: não tem a
 * coluna e o scraper a atualiza in-place, por isso tem o full refresh próprio.
 */
async function pullIncremental<T extends { id: string; atualizado_em: string }>(
  entity: SyncEntity,
  tabela: { bulkPut: (rows: T[]) => PromiseLike<unknown> }
): Promise<void> {
  const since = await getLastSyncedAt(entity);
  const rows = await buscarTudoPaginado<T>((from, to) => {
    let query = supabase.from(entity).select('*').order('atualizado_em', { ascending: true }).range(from, to);
    if (since) query = query.gt('atualizado_em', since);
    return query as PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
  });
  if (rows.length > 0) {
    // GUARDA: não sobrescrever linhas com edição local ainda não sincronizada
    // (insert/update pendente na syncQueue). Sem isso, um pull que traz a versão
    // velha do servidor engoliria uma edição que a usuária acabou de fazer e cujo
    // push ainda não completou (offline, rede lenta) — a edição "sumiria". Mesmo
    // raciocínio da guarda em reconciliarObrasDeletadas. O push envia a versão
    // local depois, e o próximo pull a traz de volta com o timestamp novo.
    const pendentes = await db.syncQueue.where('entity').equals(entity).toArray();
    const protegidos = new Set(pendentes.filter((m) => m.op !== 'delete').map((m) => m.recordId));
    const aAplicar = rows.filter((r) => !protegidos.has(r.id));
    if (aAplicar.length > 0) await tabela.bulkPut(aAplicar);
    // Avança o watermark pelo maior atualizado_em de TODAS as linhas (inclusive as
    // puladas — a ordenação é asc), pra não re-buscá-las em loop. A linha protegida
    // se reconcilia quando o push dela passar e o pull seguinte a trouxer.
    await setLastSyncedAt(entity, rows[rows.length - 1].atualizado_em);
  } else if (!since) {
    await setLastSyncedAt(entity, new Date(0).toISOString());
  }
}

/** Puxa obras alteradas no servidor desde a última sync (incremental via atualizado_em). */
async function pullObras(): Promise<void> {
  await pullIncremental<Obra>('obras', db.obras);
}

/**
 * Puxa as três tabelas do Reader. Incrementais (e não full refresh como
 * `fontes`) por causa do volume: `reader_capitulos` passa de 1000 linhas com
 * poucas obras, e é exatamente aí que o padrão de limpar-e-repovoar começou a
 * truncar silenciosamente — ver o comentário de buscarTudoPaginado.
 */
async function pullReader(): Promise<void> {
  await pullIncremental<ReaderObra>('reader_obras', db.reader_obras);
  await pullIncremental<ReaderFonte>('reader_fontes', db.reader_fontes);
  await pullIncremental<ReaderCapitulo>('reader_capitulos', db.reader_capitulos);
}

/**
 * Reconcilia deleções remotas de obras. O pull incremental (via atualizado_em)
 * nunca enxerga linhas apagadas no servidor, então uma obra deletada em outro
 * dispositivo (ou direto no Supabase) ficaria para sempre no IndexedDB local.
 * Busca só os ids do servidor (paginado — ver buscarTudoPaginado) e remove
 * localmente o que não existe mais lá.
 *
 * GUARDA CRÍTICA: ids com mutação insert/update pendente na syncQueue são
 * excluídos da remoção — são obras criadas/alteradas localmente cujo push ainda
 * não chegou ao servidor (ex.: push falhou nesta rodada por rede); apagá-las
 * destruiria dados da usuária. A checagem é feita AQUI, na hora de deletar (não
 * antes), para cobrir mutações enfileiradas no meio do próprio ciclo de sync.
 *
 * Qualquer falha aborta a reconciliação silenciosamente: nunca deletar com
 * base numa lista de ids que pode estar incompleta.
 */
async function reconciliarObrasDeletadas(): Promise<void> {
  let idsServidor: Set<string>;
  try {
    const linhas = await buscarTudoPaginado<{ id: string }>((from, to) =>
      supabase.from('obras').select('id').order('id', { ascending: true }).range(from, to)
    );
    idsServidor = new Set(linhas.map((r) => r.id));
  } catch {
    return;
  }

  // Defensivo: uma resposta vazia (sem erro) quase certamente indica um problema
  // transitório (ex.: token de auth expirando bem na hora da query) do que a
  // conta genuinamente ter zero obras — tratar como "zero" apagaria a lista
  // inteira. Só reconcilia quando o servidor claramente tem pelo menos uma.
  if (idsServidor.size === 0) return;

  const idsLocais = (await db.obras.toCollection().primaryKeys()) as string[];
  const candidatos = idsLocais.filter((id) => !idsServidor.has(id));
  if (candidatos.length === 0) return;

  const pendentes = await db.syncQueue.where('entity').equals('obras').toArray();
  const protegidos = new Set(pendentes.filter((m) => m.op !== 'delete').map((m) => m.recordId));

  const remover = candidatos.filter((id) => !protegidos.has(id));
  if (remover.length === 0) return;

  await db.obras.bulkDelete(remover);
  await db.fontes.where('obra_id').anyOf(remover).delete();
  // As tabelas do Reader penduram na obra por cascade no Postgres; localmente a
  // limpeza é explícita. reader_fontes não tem obra_id (pendura em
  // reader_obras), então é removida pelos ids das reader_obras que caíram.
  const readerObrasRemovidas = await db.reader_obras.where('obra_id').anyOf(remover).primaryKeys();
  await db.reader_obras.where('obra_id').anyOf(remover).delete();
  await db.reader_capitulos.where('obra_id').anyOf(remover).delete();
  if (readerObrasRemovidas.length > 0) {
    await db.reader_fontes.where('reader_obra_id').anyOf(readerObrasRemovidas as string[]).delete();
  }
}

/**
 * Puxa fontes do servidor. A tabela `fontes` não tem coluna de atualização
 * (só `criado_em`), e o scraper atualiza `ultimo_capitulo_detectado` in-place
 * sem mudar essa data — então não dá pra fazer pull incremental confiável.
 * Full refresh a cada sync, paginado (ver buscarTudoPaginado — acima de ~1000
 * linhas uma busca sem paginação é truncada silenciosamente pelo Supabase, e
 * foi exatamente isso que fazia fontes recentes "sumirem": a tabela passou de
 * 1000 linhas e as mais novas ficavam de fora de toda sincronização).
 *
 * GUARDA (mesmo raciocínio de pullObras): fontes com insert/update pendente na
 * syncQueue mantêm a versão LOCAL em vez de serem sobrescritas pela varredura
 * do servidor. Sem isso, uma fonte recém-criada cujo push ainda não completou
 * neste ciclo (ex.: esta chamada de sync coincidiu com outra já em andamento,
 * cujo pushPending() rodou ANTES dessa fonte ser enfileirada — ver
 * reSyncPendente abaixo) desaparecia da tela assim que este pull "limpa e
 * repõe" a tabela inteira com a versão do servidor, que ainda não tem a fonte
 * nova — e como ela nunca chegou a ser salva de verdade, nem um F5 trazia de
 * volta.
 */
async function pullFontes(): Promise<void> {
  const rows = await buscarTudoPaginado<Fonte>((from, to) =>
    supabase.from('fontes').select('*').order('id', { ascending: true }).range(from, to)
  );

  const pendentes = await db.syncQueue.where('entity').equals('fontes').toArray();
  const protegidos = new Set(pendentes.filter((m) => m.op !== 'delete').map((m) => m.recordId));

  // Transação: sem isso, uma useLiveQuery que rode bem entre o clear() e o
  // bulkPut() (operações separadas) veria a tabela momentaneamente vazia — ex.:
  // a seção Sources da obra piscando "No sources yet." no meio de um sync.
  await db.transaction('rw', db.fontes, async () => {
    const aManter = protegidos.size > 0 ? await db.fontes.where('id').anyOf([...protegidos]).toArray() : [];
    await db.fontes.clear();
    const aAplicar = rows.filter((r) => !protegidos.has(r.id));
    if (aAplicar.length > 0) await db.fontes.bulkPut(aAplicar);
    if (aManter.length > 0) await db.fontes.bulkPut(aManter);
  });
}

async function pullListas(): Promise<void> {
  const rows = await buscarTudoPaginado<ListaItem>((from, to) =>
    supabase.from('listas').select('*').order('id', { ascending: true }).range(from, to)
  );
  await db.transaction('rw', db.listas, async () => {
    await db.listas.clear();
    if (rows.length > 0) await db.listas.bulkPut(rows);
  });
}

let syncEmAndamento: Promise<{ ok: boolean; error?: unknown }> | null = null;
// Uma escrita local (ex.: adicionar uma fonte) pode acontecer DEPOIS que o
// pushPending() de um ciclo já em andamento já rodou — nesse caso a mutação
// nova só seria enviada no PRÓXIMO ciclo periódico (5 min), mas o
// pullFontes()/pullListas() (full refresh) do ciclo ATUAL ainda vai rodar e
// reescrever a tabela local com a versão do servidor, que não tem essa
// mutação — o registro recém-criado "some" da tela até o próximo sync. Essa
// flag fecha a janela: quando o ciclo em andamento termina, dispara mais um
// imediatamente (uma rodada extra só, não uma por chamada concorrente).
let reSyncPendente = false;

async function executarCicloSync(): Promise<{ ok: boolean; error?: unknown }> {
  try {
    const { falhas } = await pushPending();
    await pullObras();
    await reconciliarObrasDeletadas();
    await pullFontes();
    await pullListas();
    await pullReader();
    return falhas > 0
      ? { ok: false, error: `${falhas} alteração(ões) local(is) não sincronizaram, tentando de novo mais tarde` }
      : { ok: true };
  } catch (error) {
    console.error('Erro durante sincronização', error);
    return { ok: false, error };
  }
}

function iniciarCiclo(): Promise<{ ok: boolean; error?: unknown }> {
  const execucao = executarCicloSync().finally(() => {
    syncEmAndamento = null;
    if (reSyncPendente && isOnline()) {
      reSyncPendente = false;
      syncEmAndamento = iniciarCiclo();
    }
  });
  return execucao;
}

/**
 * Roda o ciclo completo: envia pendências, depois puxa mudanças do servidor.
 * Silencioso se offline. Chamadas concorrentes (ex.: uma atualização em massa
 * via CSV dispara uma por linha, ou o gatilho automático de uma escrita
 * enquanto o sync periódico já está rodando) compartilham a MESMA execução em
 * andamento em vez de virar no-op — antes, só a primeira chamada realmente
 * rodava pushPending e as demais recebiam `{ok: false, error: 'already-syncing'}`
 * sem nunca reagendar o envio das suas próprias mutações. Ver reSyncPendente
 * acima pra por que isso sozinho ainda não bastava.
 */
export function syncNow(): Promise<{ ok: boolean; error?: unknown }> {
  if (syncEmAndamento) {
    reSyncPendente = true;
    return syncEmAndamento;
  }
  if (!isOnline()) return Promise.resolve({ ok: false, error: 'offline' });

  syncEmAndamento = iniciarCiclo();
  return syncEmAndamento;
}
