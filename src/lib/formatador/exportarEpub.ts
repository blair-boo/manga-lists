import type { Documento, Template } from './tipos';

function escaparXml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function corpoXhtml(doc: Documento): string {
  const partes: string[] = [`<h1 class="titulo-livro">${escaparXml(doc.titulo)}</h1>`];
  let dentroLista = false;

  for (const bloco of doc.blocos) {
    if (bloco.tipo === 'item-lista') {
      if (!dentroLista) {
        partes.push('<ul>');
        dentroLista = true;
      }
      partes.push(`<li>${escaparXml(bloco.texto)}</li>`);
      continue;
    }
    if (dentroLista) {
      partes.push('</ul>');
      dentroLista = false;
    }
    if (bloco.tipo === 'h1') partes.push(`<h1>${escaparXml(bloco.texto)}</h1>`);
    else if (bloco.tipo === 'h2') partes.push(`<h2>${escaparXml(bloco.texto)}</h2>`);
    else if (bloco.tipo === 'h3') partes.push(`<h3>${escaparXml(bloco.texto)}</h3>`);
    else if (bloco.tipo === 'citacao') partes.push(`<blockquote><p>${escaparXml(bloco.texto)}</p></blockquote>`);
    else partes.push(`<p>${escaparXml(bloco.texto)}</p>`);
  }
  if (dentroLista) partes.push('</ul>');
  return partes.join('\n');
}

function cssTemplate(template: Template): string {
  return `body { font-family: ${template.fonte}; color: #111; line-height: 1.5; margin: 5%; }
h1, h2, h3, .titulo-livro { color: ${template.corDestaque}; }
.titulo-livro { font-size: ${template.tamanhosPt.titulo}pt; text-align: center; margin-bottom: 1.5em; }
h1 { font-size: ${template.tamanhosPt.h1}pt; }
h2 { font-size: ${template.tamanhosPt.h2}pt; }
h3 { font-size: ${template.tamanhosPt.h3}pt; }
p { font-size: ${template.tamanhosPt.paragrafo}pt; margin: 0 0 ${template.espacamentoParagraphoPt}pt; }
li { font-size: ${template.tamanhosPt['item-lista']}pt; }
blockquote { font-style: italic; font-size: ${template.tamanhosPt.citacao}pt; border-left: 3px solid ${template.corDestaque}; padding-left: 1em; margin-left: 0; }`;
}

export async function documentoParaEpubBlob(doc: Documento, template: Template): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const uuid = crypto.randomUUID();
  const titulo = escaparXml(doc.titulo);

  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );

  zip.file('OEBPS/style.css', cssTemplate(template));

  zip.file(
    'OEBPS/content.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${titulo}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${corpoXhtml(doc)}
</body>
</html>`
  );

  zip.file(
    'OEBPS/toc.ncx',
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${uuid}"/>
  </head>
  <docTitle><text>${titulo}</text></docTitle>
  <navMap>
    <navPoint id="navpoint-1" playOrder="1">
      <navLabel><text>${titulo}</text></navLabel>
      <content src="content.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`
  );

  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${titulo}</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="BookId">urn:uuid:${uuid}</dc:identifier>
  </metadata>
  <manifest>
    <item id="content" href="content.xhtml" media-type="application/xhtml+xml"/>
    <item id="style" href="style.css" media-type="text/css"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="content"/>
  </spine>
</package>`
  );

  return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
}

export async function baixarEpub(doc: Documento, template: Template, nomeArquivo: string): Promise<void> {
  const blob = await documentoParaEpubBlob(doc, template);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
}
