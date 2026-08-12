import { dividirLinks, nomeArquivoDaUrl, normalizarNomeArquivo, validarUrlImagem } from './imagensLinks';
import type { LinhaArquivoImagens } from './imagensArquivo';
import type { ItemImagem, OrigemImagem } from './imagensTipos';

/**
 * Une o fluxo de colar links e o de subir arquivo (CSV/XLSX) numa única lista
 * de ItemImagem — a tabela de revisão da aba Images edita/remove itens dessa
 * lista antes de qualquer download começar.
 */

let proximoId = 1;
function novoId(): string {
  return `img-${Date.now()}-${proximoId++}`;
}

function novoItem(url: string, nomeBruto: string, origem: OrigemImagem): ItemImagem {
  return {
    id: novoId(),
    url,
    nome: normalizarNomeArquivo(nomeBruto),
    origem,
    status: 'pendente',
    tentativas: 0,
  };
}

/** Converte o texto colado (links separados por `;`/linha) em itens. URLs inválidas são contadas, não incluídas. */
export function itensDeLinksColados(texto: string): { itens: ItemImagem[]; invalidos: number } {
  const links = dividirLinks(texto);
  const itens: ItemImagem[] = [];
  let invalidos = 0;
  links.forEach((link, indice) => {
    const url = validarUrlImagem(link);
    if (!url) {
      invalidos++;
      return;
    }
    itens.push(novoItem(url, nomeArquivoDaUrl(url, indice), 'colado'));
  });
  return { itens, invalidos };
}

/** Converte as linhas {link, nome} do arquivo (CSV/XLSX) em itens; nome em branco cai pro nome derivado da URL. */
export function itensDeLinhasArquivo(linhas: LinhaArquivoImagens[]): { itens: ItemImagem[]; invalidos: number } {
  const itens: ItemImagem[] = [];
  let invalidos = 0;
  linhas.forEach((linha, indice) => {
    const url = validarUrlImagem(linha.link);
    if (!url) {
      invalidos++;
      return;
    }
    const nome = linha.nome.trim() || nomeArquivoDaUrl(url, indice);
    itens.push(novoItem(url, nome, 'arquivo'));
  });
  return { itens, invalidos };
}

/** Mescla itens novos na lista atual, descartando URLs já presentes (mesma URL exata). */
export function mesclarItens(atual: ItemImagem[], novos: ItemImagem[]): { itens: ItemImagem[]; duplicados: number } {
  const urlsVistas = new Set(atual.map((i) => i.url));
  const itens = [...atual];
  let duplicados = 0;
  for (const item of novos) {
    if (urlsVistas.has(item.url)) {
      duplicados++;
      continue;
    }
    urlsVistas.add(item.url);
    itens.push(item);
  }
  return { itens, duplicados };
}

/** Ids dos itens cujo nome final colide com o de outro item da própria lista (mesmo nome, comparação exata). */
export function detectarColisoesNaLista(itens: ItemImagem[]): Set<string> {
  const porNome = new Map<string, number>();
  for (const item of itens) porNome.set(item.nome, (porNome.get(item.nome) ?? 0) + 1);
  const colisoes = new Set<string>();
  for (const item of itens) {
    if ((porNome.get(item.nome) ?? 0) > 1) colisoes.add(item.id);
  }
  return colisoes;
}

/** Resolve uma colisão de nome contra o destino final (pasta) acrescentando sufixo -2, -3, ... até achar um nome livre. */
export function resolverColisaoNome(nomeDesejado: string, nomesExistentes: Set<string>): string {
  if (!nomesExistentes.has(nomeDesejado)) return nomeDesejado;
  const pontoFinal = nomeDesejado.lastIndexOf('.');
  const base = pontoFinal > 0 ? nomeDesejado.slice(0, pontoFinal) : nomeDesejado;
  const extensao = pontoFinal > 0 ? nomeDesejado.slice(pontoFinal) : '';
  let sufixo = 2;
  let candidato = `${base}-${sufixo}${extensao}`;
  while (nomesExistentes.has(candidato)) {
    sufixo++;
    candidato = `${base}-${sufixo}${extensao}`;
  }
  return candidato;
}
