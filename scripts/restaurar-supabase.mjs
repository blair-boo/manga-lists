// Verifica e restaura um backup do R2 (gerado por scripts/backup-supabase.mjs).
//
//   node scripts/restaurar-supabase.mjs --verificar [--backup db/weekly/2026-10-09]
//   node scripts/restaurar-supabase.mjs --restaurar --confirmo <host-do-alvo> [--backup ...] [--arquivos] [--executar]
//
// --verificar: baixa o backup do R2 e confere a integridade (JSON legível,
//   contagem de linhas igual à do manifest.json). Só lê; é o que o workflow de
//   backup roda toda semana logo depois de gravar, pra nunca descobrir só na
//   hora do desastre que o backup não presta. Sem --backup, usa o weekly mais novo.
//
// --restaurar: grava o backup num projeto Supabase ALVO. Por padrão é ensaio
//   (mostra o que faria e não escreve nada); só escreve com --executar.
//   O alvo vem de ALVO_SUPABASE_URL e ALVO_SUPABASE_SERVICE_ROLE_KEY (nomes
//   diferentes de propósito: as variáveis SUPABASE_* do backup apontam pra
//   produção e nunca devem ser reaproveitadas por engano). --confirmo precisa
//   repetir o host do alvo (ex.: abcd1234.supabase.co).
//
// O backup guarda DADOS, não o schema: antes de restaurar, aplique as migrations
// (supabase/migrations) no projeto alvo, inclusive buckets e policies. Usuários
// do Auth também não entram no backup: crie o login no projeto alvo.
//
// Tabelas com chave estrangeira são regravadas em várias passadas: a que falha
// por FK espera as outras e tenta de novo, sem precisar conhecer a ordem.
// Ambiente: R2_BUCKET e RCLONE_CONFIG_R2_* (iguais ao backup).

import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const GRUPOS = ['weekly', 'monthly'];
const TABELAS_IGNORADAS = new Set(['backup_status']);
const TAMANHO_LOTE = 500;
const MAX_PASSADAS = 8;
const CAMINHO_VALIDO = /^db\/(weekly|monthly)\/\d{4}-\d{2}(-\d{2})?$/;

const TIPOS_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  json: 'application/json',
  md: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
};

// --- Utilitários de rede e rclone (mesmos do backup) --------------------------

const executar = promisify(execFile);
const TIMEOUT_MS = 60_000;

function cabecalhos(chave) {
  return { apikey: chave, Authorization: `Bearer ${chave}` };
}

async function requisitar(url, opcoes = {}) {
  const resposta = await fetch(url, { ...opcoes, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!resposta.ok) {
    const corpo = (await resposta.text()).slice(0, 300);
    throw new Error(`HTTP ${resposta.status} em ${new URL(url).pathname}: ${corpo}`);
  }
  return resposta;
}

async function rclone(...args) {
  try {
    const { stdout } = await executar('rclone', args, { maxBuffer: 512 * 1024 * 1024 });
    return stdout;
  } catch (erro) {
    throw new Error(`rclone ${args[0]} falhou: ${String(erro.stderr ?? erro.message).trim().slice(0, 500)}`);
  }
}

/** Colunas de cada tabela/view do OpenAPI do PostgREST. */
function tabelasDoOpenApi(spec) {
  const tabelas = {};
  for (const [nome, def] of Object.entries(spec?.definitions ?? {})) {
    const colunas = Object.keys(def?.properties ?? {});
    if (colunas.length > 0) tabelas[nome] = colunas;
  }
  return tabelas;
}

/** Só as tabelas com chave primária declarada (marcada com `<pk/>`), no formato
 *  tabela -> colunas da chave. Usado na restauração: upsert exige chave. */
export function chavesPrimariasDoOpenApi(spec) {
  const chaves = {};
  for (const [nome, def] of Object.entries(spec?.definitions ?? {})) {
    const pk = Object.entries(def?.properties ?? {})
      .filter(([, prop]) => String(prop?.description ?? '').includes('<pk/>'))
      .map(([coluna]) => coluna);
    if (pk.length > 0) chaves[nome] = pk;
  }
  return chaves;
}

// --- Regras puras (testadas em restaurar-supabase.test.mjs) ------------------

/** Nome do backup mais novo (AAAA-MM-DD ordena como data), ou null se não há nenhum. */
export function escolherBackup(pastas) {
  return pastas.length === 0 ? null : [...pastas].sort().at(-1);
}

/** Problemas de integridade do backup (lista vazia = íntegro). `tabelas` é
 *  nome -> conteúdo já lido (array) ou null se o JSON não pôde ser lido. */
export function validarBackup(manifest, tabelas) {
  const linhas = manifest?.linhas;
  if (!linhas || typeof linhas !== 'object') return ['manifest.json ausente ou inválido'];
  const problemas = [];
  for (const [tabela, esperado] of Object.entries(linhas)) {
    if (!(tabela in tabelas)) problemas.push(`${tabela}: arquivo ausente no backup`);
    else if (!Array.isArray(tabelas[tabela])) problemas.push(`${tabela}: JSON ilegível`);
    else if (tabelas[tabela].length !== esperado) {
      problemas.push(`${tabela}: o manifest diz ${esperado} linhas, o arquivo tem ${tabelas[tabela].length}`);
    }
  }
  for (const tabela of Object.keys(tabelas)) {
    if (!(tabela in linhas)) problemas.push(`${tabela}: arquivo fora do manifest`);
  }
  return problemas;
}

export function lotes(lista, tamanho = TAMANHO_LOTE) {
  const resultado = [];
  for (let i = 0; i < lista.length; i += tamanho) resultado.push(lista.slice(i, i + tamanho));
  return resultado;
}

export function tipoMime(nomeArquivo) {
  const ext = nomeArquivo.split('.').at(-1)?.toLowerCase() ?? '';
  return TIPOS_MIME[ext] ?? 'application/octet-stream';
}

/** 23503 = violação de chave estrangeira no Postgres (pai ainda não restaurado). */
export function ehErroDeChaveEstrangeira(corpo) {
  try {
    return JSON.parse(corpo)?.code === '23503';
  } catch {
    return false;
  }
}

export function lerArgumentos(argv) {
  const opcoes = { modo: null, backup: null, executar: false, arquivos: false, confirmo: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--verificar') opcoes.modo = 'verificar';
    else if (arg === '--restaurar') opcoes.modo = 'restaurar';
    else if (arg === '--executar') opcoes.executar = true;
    else if (arg === '--arquivos') opcoes.arquivos = true;
    else if (arg === '--backup') opcoes.backup = argv[++i] ?? null;
    else if (arg === '--confirmo') opcoes.confirmo = argv[++i] ?? null;
    else throw new Error(`Argumento desconhecido: ${arg}`);
  }
  if (opcoes.modo === null) throw new Error('Informe --verificar ou --restaurar.');
  if (opcoes.backup !== null && !CAMINHO_VALIDO.test(opcoes.backup)) {
    throw new Error(`--backup inválido: use db/weekly/AAAA-MM-DD ou db/monthly/AAAA-MM (recebido: ${opcoes.backup}).`);
  }
  return opcoes;
}

// --- Leitura do backup no R2 -------------------------------------------------

async function descobrirBackup(raizR2, caminho) {
  if (caminho) return caminho;
  const pastas = (await rclone('lsf', '--dirs-only', `${raizR2}/db/${GRUPOS[0]}`)).split('\n').filter(Boolean).map((p) => p.replace(/\/$/, ''));
  const maisNovo = escolherBackup(pastas);
  if (maisNovo === null) throw new Error(`Nenhum backup encontrado em db/${GRUPOS[0]}.`);
  return `db/${GRUPOS[0]}/${maisNovo}`;
}

async function carregarBackup(raizR2, caminho, tmp) {
  const destino = path.join(tmp, 'db');
  await rclone('copy', `${raizR2}/${caminho}`, destino);
  let manifest = null;
  try {
    manifest = JSON.parse(await readFile(path.join(destino, 'manifest.json'), 'utf8'));
  } catch {
    // validarBackup reporta o manifest ausente ou inválido
  }
  const tabelas = {};
  for (const arquivo of await readdir(destino).catch(() => [])) {
    if (!arquivo.endsWith('.json') || arquivo === 'manifest.json') continue;
    try {
      tabelas[arquivo.replace(/\.json$/, '')] = JSON.parse(await readFile(path.join(destino, arquivo), 'utf8'));
    } catch {
      tabelas[arquivo.replace(/\.json$/, '')] = null;
    }
  }
  return { manifest, tabelas };
}

// --- Restauração no projeto alvo ---------------------------------------------

async function tentarUpsert(base, chave, tabela, linhas, colunasChave) {
  const resposta = await fetch(`${base}/rest/v1/${encodeURIComponent(tabela)}?on_conflict=${colunasChave.join(',')}`, {
    method: 'POST',
    headers: { ...cabecalhos(chave), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(linhas),
    signal: AbortSignal.timeout(120_000),
  });
  return resposta.ok ? { ok: true } : { ok: false, status: resposta.status, corpo: (await resposta.text()).slice(0, 400) };
}

async function contarLinhas(base, chave, tabela) {
  const resposta = await requisitar(`${base}/rest/v1/${encodeURIComponent(tabela)}?select=*`, {
    headers: { ...cabecalhos(chave), Range: '0-0', 'Range-Unit': 'items', Prefer: 'count=exact' },
  });
  return Number(resposta.headers.get('content-range').split('/')[1]);
}

async function restaurarTabelas(base, chave, tabelas, spec) {
  const chavesPrimarias = chavesPrimariasDoOpenApi(spec);
  const existentes = tabelasDoOpenApi(spec);
  const ausentes = Object.keys(tabelas).filter((t) => !TABELAS_IGNORADAS.has(t) && !(t in existentes));
  if (ausentes.length > 0) {
    throw new Error(`Tabelas do backup que não existem no alvo: ${ausentes.join(', ')}. Aplique as migrations no alvo antes.`);
  }
  // Existem no alvo mas sem chave primária (ex.: views): não há o que regravar.
  const puladas = new Set(TABELAS_IGNORADAS);
  for (const tabela of Object.keys(tabelas)) {
    if (!puladas.has(tabela) && !(tabela in chavesPrimarias)) {
      console.log(`  ${tabela}: sem chave primária no alvo (view?), pulada`);
      puladas.add(tabela);
    }
  }
  let pendentes = Object.keys(tabelas).filter((t) => !puladas.has(t) && tabelas[t].length > 0);
  for (let passada = 1; pendentes.length > 0 && passada <= MAX_PASSADAS; passada++) {
    console.log(`Passada ${passada}: ${pendentes.length} tabela(s)`);
    const aindaPendentes = [];
    for (const tabela of pendentes) {
      let falhaDeChave = false;
      for (const lote of lotes(tabelas[tabela])) {
        const resultado = await tentarUpsert(base, chave, tabela, lote, chavesPrimarias[tabela]);
        if (resultado.ok) continue;
        if (ehErroDeChaveEstrangeira(resultado.corpo)) {
          falhaDeChave = true;
          break;
        }
        throw new Error(`${tabela}: HTTP ${resultado.status} ${resultado.corpo}`);
      }
      if (falhaDeChave) aindaPendentes.push(tabela);
      else console.log(`  ${tabela}: ${tabelas[tabela].length} linhas`);
    }
    if (aindaPendentes.length === pendentes.length) {
      throw new Error(`Sem progresso por chave estrangeira em: ${aindaPendentes.join(', ')}. Falta algum registro pai que não está no backup.`);
    }
    pendentes = aindaPendentes;
  }
  if (pendentes.length > 0) throw new Error(`Restauração incompleta após ${MAX_PASSADAS} passadas: ${pendentes.join(', ')}`);
  return puladas;
}

async function restaurarArquivos(base, chave, raizR2, tmp) {
  const buckets = (await rclone('lsf', '--dirs-only', `${raizR2}/storage`)).split('\n').filter(Boolean).map((p) => p.replace(/\/$/, ''));
  const existentes = new Set((await (await requisitar(`${base}/storage/v1/bucket`, { headers: cabecalhos(chave) })).json()).map((b) => b.id));
  for (const bucket of buckets) {
    if (!existentes.has(bucket)) {
      console.log(`  bucket ${bucket}: não existe no alvo, pulado (crie pelas migrations e rode de novo)`);
      continue;
    }
    const pasta = path.join(tmp, 'storage', bucket);
    await rclone('copy', `${raizR2}/storage/${bucket}`, pasta);
    let enviados = 0;
    const percorrer = async (dir, prefixo) => {
      for (const nome of await readdir(dir)) {
        const completo = path.join(dir, nome);
        if ((await stat(completo)).isDirectory()) await percorrer(completo, `${prefixo}${nome}/`);
        else {
          const rota = `${prefixo}${nome}`.split('/').map(encodeURIComponent).join('/');
          await requisitar(`${base}/storage/v1/object/${encodeURIComponent(bucket)}/${rota}`, {
            method: 'POST',
            headers: { ...cabecalhos(chave), 'Content-Type': tipoMime(nome), 'x-upsert': 'true' },
            body: createReadStream(completo),
            duplex: 'half',
          });
          enviados++;
        }
      }
    };
    await percorrer(pasta, '');
    console.log(`  bucket ${bucket}: ${enviados} arquivos`);
  }
}

// --- Orquestração ------------------------------------------------------------

async function principal() {
  const opcoes = lerArgumentos(process.argv.slice(2));
  if (!process.env.R2_BUCKET) throw new Error('Variável de ambiente ausente: R2_BUCKET');
  const raizR2 = `r2:${process.env.R2_BUCKET}`;
  const tmp = await mkdtemp(path.join(tmpdir(), 'restaurar-'));
  try {
    const caminho = await descobrirBackup(raizR2, opcoes.backup);
    console.log(`Backup: ${caminho}`);
    const { manifest, tabelas } = await carregarBackup(raizR2, caminho, tmp);
    const problemas = validarBackup(manifest, tabelas);
    if (problemas.length > 0) throw new Error(`Backup com problemas:\n  - ${problemas.join('\n  - ')}`);
    const total = Object.values(manifest.linhas).reduce((soma, n) => soma + n, 0);
    console.log(`Íntegro: ${Object.keys(tabelas).length} tabelas, ${total} linhas.`);
    if (opcoes.modo === 'verificar') return;

    const faltando = ['ALVO_SUPABASE_URL', 'ALVO_SUPABASE_SERVICE_ROLE_KEY'].filter((nome) => !process.env[nome]);
    if (faltando.length > 0) throw new Error(`Variáveis de ambiente ausentes: ${faltando.join(', ')}`);
    const base = process.env.ALVO_SUPABASE_URL.replace(/\/$/, '');
    const chave = process.env.ALVO_SUPABASE_SERVICE_ROLE_KEY;
    const host = new URL(base).host;
    if (opcoes.confirmo !== host) throw new Error(`Para restaurar, repita o host do alvo: --confirmo ${host}`);

    if (!opcoes.executar) {
      console.log(`\nENSAIO (nada foi escrito). Restauraria em ${host}:`);
      for (const [tabela, linhas] of Object.entries(tabelas)) {
        if (!TABELAS_IGNORADAS.has(tabela)) console.log(`  ${tabela}: ${linhas.length} linhas`);
      }
      console.log(`${opcoes.arquivos ? 'Também restauraria' : 'Não restauraria'} os arquivos do Storage (--arquivos). Use --executar para gravar.`);
      return;
    }

    const spec = await (await requisitar(`${base}/rest/v1/`, { headers: { ...cabecalhos(chave), Accept: 'application/openapi+json' } })).json();
    const puladas = await restaurarTabelas(base, chave, tabelas, spec);
    if (opcoes.arquivos) {
      console.log('Arquivos do Storage');
      await restaurarArquivos(base, chave, raizR2, tmp);
    }

    console.log('Conferindo contagens no alvo');
    let divergencias = 0;
    for (const [tabela, esperado] of Object.entries(manifest.linhas)) {
      if (puladas.has(tabela)) continue;
      const atual = await contarLinhas(base, chave, tabela);
      if (atual < esperado) {
        divergencias++;
        console.log(`  ${tabela}: esperado ${esperado}, alvo tem ${atual}`);
      }
    }
    if (divergencias > 0) throw new Error(`${divergencias} tabela(s) com menos linhas que o backup.`);
    console.log('Restauração concluída e conferida.');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  principal().catch((erro) => {
    console.error(`Falhou: ${erro.message}`);
    process.exit(1);
  });
}
