import type { Documento, Template } from './tipos';

const COR_TEXTO: [number, number, number] = [17, 17, 17];

function corRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export async function documentoParaPdfBlob(doc: Documento, template: Template): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const margem = 56;
  const larguraUtil = pdf.internal.pageSize.getWidth() - margem * 2;
  const alturaPagina = pdf.internal.pageSize.getHeight();
  const corDestaque = corRgb(template.corDestaque);
  let y = margem;

  function escreverBloco(
    texto: string,
    tamanho: number,
    opts: { negrito?: boolean; italico?: boolean; destaque?: boolean; indent?: number; espacoDepois: number }
  ) {
    pdf.setFont(template.fontePdf, opts.negrito ? 'bold' : opts.italico ? 'italic' : 'normal');
    pdf.setFontSize(tamanho);
    pdf.setTextColor(...(opts.destaque ? corDestaque : COR_TEXTO));

    const indent = opts.indent ?? 0;
    const linhas = pdf.splitTextToSize(texto, larguraUtil - indent) as string[];
    const alturaLinha = tamanho * 1.35;

    if (y + linhas.length * alturaLinha > alturaPagina - margem) {
      pdf.addPage();
      y = margem;
    }
    for (const linha of linhas) {
      pdf.text(linha, margem + indent, y);
      y += alturaLinha;
    }
    y += opts.espacoDepois;
  }

  escreverBloco(doc.titulo, template.tamanhosPt.titulo, { negrito: true, destaque: true, espacoDepois: 20 });

  for (const bloco of doc.blocos) {
    if (bloco.tipo === 'h1') escreverBloco(bloco.texto, template.tamanhosPt.h1, { negrito: true, destaque: true, espacoDepois: 12 });
    else if (bloco.tipo === 'h2') escreverBloco(bloco.texto, template.tamanhosPt.h2, { negrito: true, destaque: true, espacoDepois: 10 });
    else if (bloco.tipo === 'h3') escreverBloco(bloco.texto, template.tamanhosPt.h3, { negrito: true, destaque: true, espacoDepois: 8 });
    else if (bloco.tipo === 'citacao')
      escreverBloco(`"${bloco.texto}"`, template.tamanhosPt.citacao, { italico: true, indent: 24, espacoDepois: template.espacamentoParagraphoPt });
    else if (bloco.tipo === 'item-lista') escreverBloco(`•  ${bloco.texto}`, template.tamanhosPt['item-lista'], { indent: 14, espacoDepois: 4 });
    else escreverBloco(bloco.texto, template.tamanhosPt.paragrafo, { espacoDepois: template.espacamentoParagraphoPt });
  }

  return pdf.output('blob');
}

export async function baixarPdf(doc: Documento, template: Template, nomeArquivo: string): Promise<void> {
  const blob = await documentoParaPdfBlob(doc, template);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
}
