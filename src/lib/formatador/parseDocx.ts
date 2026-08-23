import type { Bloco, Documento } from './tipos';
import { extrairTitulo } from './parseMarkdown';

const MAPA_TAG: Record<string, Bloco['tipo'] | undefined> = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h3',
  h5: 'h3',
  h6: 'h3',
  p: 'paragrafo',
  li: 'item-lista',
  blockquote: 'citacao',
};

/** .docx → Documento via mammoth (docx → HTML) + varredura do HTML resultante. */
export async function parseDocx(arquivo: File, nomeArquivoSemExtensao: string): Promise<Documento> {
  const mammoth = await import('mammoth');
  const arrayBuffer = await arquivo.arrayBuffer();
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer });

  const dom = new DOMParser().parseFromString(html, 'text/html');
  const blocos: Bloco[] = [];
  for (const el of dom.body.children) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'ul' || tag === 'ol') {
      for (const li of el.querySelectorAll(':scope > li')) {
        const texto = (li.textContent ?? '').trim();
        if (texto) blocos.push({ tipo: 'item-lista', texto });
      }
      continue;
    }
    const tipo = MAPA_TAG[tag];
    if (!tipo) continue;
    const texto = (el.textContent ?? '').trim();
    if (!texto) continue;
    blocos.push({ tipo, texto });
  }

  return extrairTitulo(blocos, nomeArquivoSemExtensao);
}
