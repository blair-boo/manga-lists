import type { Bloco, Documento } from './tipos';
import { extrairTitulo } from './parseMarkdown';

interface LinhaExtraida {
  texto: string;
  tamanhoFonte: number;
  y: number;
  alturaLinha: number;
}

function ehItemListaPdf(texto: string): string | null {
  const marcado = texto.match(/^[•▪‣◦-]\s+(.*)/);
  if (marcado) return marcado[1];
  const numerado = texto.match(/^\d+[.)]\s+(.*)/);
  if (numerado) return numerado[1];
  return null;
}

function tamanhoMaisComum(tamanhos: number[]): number {
  const contagem = new Map<number, number>();
  for (const t of tamanhos) {
    const arredondado = Math.round(t);
    contagem.set(arredondado, (contagem.get(arredondado) ?? 0) + 1);
  }
  let melhor = 0;
  let melhorContagem = 0;
  for (const [tamanho, qtd] of contagem) {
    if (qtd > melhorContagem) {
      melhor = tamanho;
      melhorContagem = qtd;
    }
  }
  return melhor || 12;
}

/**
 * .pdf → Documento: extrai o texto por página com pdf.js e classifica cada
 * linha em título/parágrafo comparando o tamanho de fonte com o tamanho mais
 * comum do documento (a "fonte do corpo do texto"). PDF não guarda estrutura
 * semântica, então é heurística — funciona bem pra PDFs gerados a partir de
 * Word/LaTeX/Docs, onde títulos realmente usam fonte maior.
 */
export async function parsePdf(arquivo: File, nomeArquivoSemExtensao: string): Promise<Documento> {
  const pdfjsLib = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

  const arrayBuffer = await arquivo.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const linhas: LinhaExtraida[] = [];
  for (let numPagina = 1; numPagina <= pdf.numPages; numPagina++) {
    const pagina = await pdf.getPage(numPagina);
    const conteudo = await pagina.getTextContent();

    let linhaAtual: { partes: string[]; tamanhoFonte: number; y: number } | null = null;
    for (const item of conteudo.items) {
      if (!('str' in item)) continue;
      const texto = item.str;
      const y = item.transform[5];
      const tamanhoFonte = Math.hypot(item.transform[0], item.transform[1]) || 12;

      if (linhaAtual && Math.abs(linhaAtual.y - y) > 2) {
        linhas.push({
          texto: linhaAtual.partes.join('').trim(),
          tamanhoFonte: linhaAtual.tamanhoFonte,
          y: linhaAtual.y,
          alturaLinha: 0,
        });
        linhaAtual = null;
      }

      if (!linhaAtual) linhaAtual = { partes: [], tamanhoFonte, y };
      linhaAtual.partes.push(texto);
      linhaAtual.tamanhoFonte = Math.max(linhaAtual.tamanhoFonte, tamanhoFonte);

      if (item.hasEOL) {
        linhas.push({ texto: linhaAtual.partes.join('').trim(), tamanhoFonte: linhaAtual.tamanhoFonte, y: linhaAtual.y, alturaLinha: 0 });
        linhaAtual = null;
      }
    }
    if (linhaAtual) {
      linhas.push({ texto: (linhaAtual as { partes: string[] }).partes.join('').trim(), tamanhoFonte: linhaAtual.tamanhoFonte, y: linhaAtual.y, alturaLinha: 0 });
    }
  }

  const linhasComTexto = linhas.filter((l) => l.texto !== '');
  const tamanhoCorpo = tamanhoMaisComum(linhasComTexto.map((l) => l.tamanhoFonte));

  const blocos: Bloco[] = [];
  let bufferParagrafo: string[] = [];
  let yAnterior: number | null = null;
  const GAP_QUEBRA_PARAGRAFO = tamanhoCorpo * 1.8;

  function flushParagrafo() {
    if (bufferParagrafo.length === 0) return;
    blocos.push({ tipo: 'paragrafo', texto: bufferParagrafo.join(' ').trim() });
    bufferParagrafo = [];
  }

  for (const linha of linhasComTexto) {
    const gapGrande = yAnterior !== null && Math.abs(yAnterior - linha.y) > GAP_QUEBRA_PARAGRAFO;
    yAnterior = linha.y;

    const razao = linha.tamanhoFonte / tamanhoCorpo;
    if (razao >= 1.35) {
      flushParagrafo();
      blocos.push({ tipo: 'h1', texto: linha.texto });
      continue;
    }
    if (razao >= 1.18) {
      flushParagrafo();
      blocos.push({ tipo: 'h2', texto: linha.texto });
      continue;
    }
    if (razao >= 1.06) {
      flushParagrafo();
      blocos.push({ tipo: 'h3', texto: linha.texto });
      continue;
    }

    const itemLista = ehItemListaPdf(linha.texto);
    if (itemLista !== null) {
      flushParagrafo();
      blocos.push({ tipo: 'item-lista', texto: itemLista });
      continue;
    }

    if (gapGrande) flushParagrafo();
    bufferParagrafo.push(linha.texto);
  }
  flushParagrafo();

  return extrairTitulo(blocos, nomeArquivoSemExtensao);
}
