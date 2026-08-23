import type { Bloco, Documento, TipoBloco } from './tipos';

function nivelTitulo(marcadores: string): TipoBloco {
  if (marcadores.length === 1) return 'h1';
  if (marcadores.length === 2) return 'h2';
  return 'h3';
}

function ehItemLista(linha: string): string | null {
  const marcado = linha.match(/^\s*[-*+]\s+(.*)/);
  if (marcado) return marcado[1];
  const numerado = linha.match(/^\s*\d+[.)]\s+(.*)/);
  if (numerado) return numerado[1];
  return null;
}

/** Parser de Markdown "bom o suficiente": cabeçalhos, listas, citações e parágrafos — sem negrito/itálico/links inline. */
export function parseMarkdown(conteudo: string, nomeArquivoSemExtensao: string): Documento {
  const linhas = conteudo.replace(/\r\n/g, '\n').split('\n');
  const blocos: Bloco[] = [];
  let bufferParagrafo: string[] = [];

  function flushParagrafo() {
    if (bufferParagrafo.length === 0) return;
    blocos.push({ tipo: 'paragrafo', texto: bufferParagrafo.join(' ').trim() });
    bufferParagrafo = [];
  }

  for (const linhaBruta of linhas) {
    const linha = linhaBruta.trimEnd();

    if (linha.trim() === '') {
      flushParagrafo();
      continue;
    }

    const titulo = linha.match(/^(#{1,6})\s+(.*)/);
    if (titulo) {
      flushParagrafo();
      blocos.push({ tipo: nivelTitulo(titulo[1]), texto: titulo[2].trim() });
      continue;
    }

    const citacao = linha.match(/^>\s?(.*)/);
    if (citacao) {
      flushParagrafo();
      blocos.push({ tipo: 'citacao', texto: citacao[1].trim() });
      continue;
    }

    const itemLista = ehItemLista(linha);
    if (itemLista !== null) {
      flushParagrafo();
      blocos.push({ tipo: 'item-lista', texto: itemLista.trim() });
      continue;
    }

    bufferParagrafo.push(linha.trim());
  }
  flushParagrafo();

  return extrairTitulo(blocos, nomeArquivoSemExtensao);
}

/** Usa o 1º h1 como título do documento (removendo-o dos blocos); sem h1, cai pro nome do arquivo. */
export function extrairTitulo(blocos: Bloco[], nomeArquivoSemExtensao: string): Documento {
  const indiceH1 = blocos.findIndex((b) => b.tipo === 'h1');
  if (indiceH1 === -1) return { titulo: nomeArquivoSemExtensao, blocos };
  const titulo = blocos[indiceH1].texto || nomeArquivoSemExtensao;
  const resto = [...blocos.slice(0, indiceH1), ...blocos.slice(indiceH1 + 1)];
  return { titulo, blocos: resto };
}
