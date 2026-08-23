import type { Documento, Template } from './tipos';

function corSemHash(hex: string): string {
  return hex.replace('#', '');
}

function nomeFonte(pilhaCss: string): string {
  return pilhaCss.split(',')[0].trim().replace(/['"]/g, '');
}

export async function documentoParaDocxBlob(doc: Documento, template: Template): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');
  const fonte = nomeFonte(template.fonte);
  const cor = corSemHash(template.corDestaque);

  const paragrafos = doc.blocos.map((bloco) => {
    if (bloco.tipo === 'h1') return new Paragraph({ text: bloco.texto, heading: HeadingLevel.HEADING_1 });
    if (bloco.tipo === 'h2') return new Paragraph({ text: bloco.texto, heading: HeadingLevel.HEADING_2 });
    if (bloco.tipo === 'h3') return new Paragraph({ text: bloco.texto, heading: HeadingLevel.HEADING_3 });
    if (bloco.tipo === 'citacao') {
      return new Paragraph({
        indent: { left: 480 },
        children: [new TextRun({ text: bloco.texto, italics: true })],
      });
    }
    if (bloco.tipo === 'item-lista') return new Paragraph({ text: bloco.texto, bullet: { level: 0 } });
    return new Paragraph({ text: bloco.texto, spacing: { after: template.espacamentoParagraphoPt * 20 } });
  });

  const documento = new Document({
    styles: {
      default: {
        document: { run: { font: fonte, size: template.tamanhosPt.paragrafo * 2 } },
      },
      paragraphStyles: [
        {
          id: 'Title',
          name: 'Title',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: fonte, size: template.tamanhosPt.titulo * 2, bold: true, color: cor },
          paragraph: { spacing: { after: 360 } },
        },
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: fonte, size: template.tamanhosPt.h1 * 2, bold: true, color: cor },
          paragraph: { spacing: { before: 280, after: 160 } },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: fonte, size: template.tamanhosPt.h2 * 2, bold: true, color: cor },
          paragraph: { spacing: { before: 220, after: 120 } },
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: fonte, size: template.tamanhosPt.h3 * 2, bold: true, color: cor },
          paragraph: { spacing: { before: 180, after: 100 } },
        },
      ],
    },
    sections: [
      {
        children: [
          new Paragraph({ text: doc.titulo, heading: HeadingLevel.TITLE }),
          ...paragrafos,
        ],
      },
    ],
  });

  return Packer.toBlob(documento);
}

export async function baixarDocx(doc: Documento, template: Template, nomeArquivo: string): Promise<void> {
  const blob = await documentoParaDocxBlob(doc, template);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
}
