import { baixarImagemViaProxy } from './imageProxy';
import { garantirExtensao } from './imagensLinks';
import { resolverColisaoNome } from './imagensLista';
import { baixarViaBlobLink, salvarArquivoLocal, type PastaLocalHandle } from './imagensLocal';
import { enviarImagemSupabase } from './imagensSupabase';
import type { ItemImagem } from './imagensTipos';

/**
 * Execução em lote da aba Images: baixa cada item via image-proxy e grava no
 * destino escolhido, com concorrência limitada e um try/catch por item — um
 * link ruim nunca derruba o resto do lote.
 */

export type ContextoDestino =
  | { destino: 'local'; modo: 'directory-handle'; pastaHandle: PastaLocalHandle }
  | { destino: 'local'; modo: 'blob-link' }
  | { destino: 'supabase'; pasta: string };
// Uma variante 'google-drive' entra aqui no futuro (fase seguinte, ver plano) sem mexer no resto deste módulo.

const CONCORRENCIA_PADRAO = 3;

async function gravarNoDestino(
  blob: Blob,
  contentType: string,
  nomeArquivo: string,
  destino: ContextoDestino
): Promise<string | undefined> {
  if (destino.destino === 'supabase') {
    return enviarImagemSupabase(blob, destino.pasta, nomeArquivo, contentType);
  }
  if (destino.modo === 'directory-handle') {
    await salvarArquivoLocal(destino.pastaHandle, nomeArquivo, blob);
    return undefined;
  }
  baixarViaBlobLink(nomeArquivo, blob);
  return undefined;
}

async function processarItem(
  item: ItemImagem,
  destino: ContextoDestino,
  nomesExistentes: Set<string>
): Promise<ItemImagem> {
  try {
    const { blob, contentType } = await baixarImagemViaProxy(item.url);
    const nomeComExtensao = garantirExtensao(item.nome, contentType);
    // Resolução de colisão + reserva do nome são síncronas, sem await entre
    // elas — mesmo com workers concorrentes, dois itens nunca reservam o
    // mesmo nome (event loop cooperativo, não há como interlear aqui).
    const nomeFinal = resolverColisaoNome(nomeComExtensao, nomesExistentes);
    nomesExistentes.add(nomeFinal);
    const urlResultado = await gravarNoDestino(blob, contentType, nomeFinal, destino);
    return { ...item, nome: nomeFinal, status: 'sucesso', urlResultado, erro: undefined, tentativas: item.tentativas + 1 };
  } catch (err) {
    return {
      ...item,
      status: 'erro',
      erro: err instanceof Error ? err.message : String(err),
      tentativas: item.tentativas + 1,
    };
  }
}

export async function executarBatch(
  itens: ItemImagem[],
  destino: ContextoDestino,
  nomesExistentes: Set<string>,
  opcoes: { concorrencia?: number; onProgresso: (item: ItemImagem) => void }
): Promise<{ sucesso: number; erro: number }> {
  const concorrencia = opcoes.concorrencia ?? CONCORRENCIA_PADRAO;
  let indice = 0;
  let sucesso = 0;
  let erro = 0;

  async function worker() {
    while (indice < itens.length) {
      const minhaVez = indice++;
      const item = itens[minhaVez];
      opcoes.onProgresso({ ...item, status: 'baixando' });
      const resultado = await processarItem(item, destino, nomesExistentes);
      if (resultado.status === 'sucesso') sucesso++;
      else erro++;
      opcoes.onProgresso(resultado);
    }
  }

  const workers = Array.from({ length: Math.min(concorrencia, itens.length) }, () => worker());
  await Promise.all(workers);
  return { sucesso, erro };
}

/** Refaz só o item que falhou — não reprocessa o lote inteiro. */
export async function retentarItem(
  item: ItemImagem,
  destino: ContextoDestino,
  nomesExistentes: Set<string>
): Promise<ItemImagem> {
  return processarItem(item, destino, nomesExistentes);
}
