import type { Documento } from './tipos';
import { parseMarkdown } from './parseMarkdown';
import { parseDocx } from './parseDocx';
import { parsePdf } from './parsePdf';

export type FormatoEntrada = 'md' | 'docx' | 'pdf';

export function detectarFormatoEntrada(arquivo: File): FormatoEntrada | null {
  const nome = arquivo.name.toLowerCase();
  if (nome.endsWith('.md') || nome.endsWith('.markdown') || nome.endsWith('.txt')) return 'md';
  if (nome.endsWith('.docx')) return 'docx';
  if (nome.endsWith('.pdf')) return 'pdf';
  if (arquivo.type === 'application/pdf') return 'pdf';
  if (arquivo.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  return null;
}

function semExtensao(nomeArquivo: string): string {
  return nomeArquivo.replace(/\.[^./\\]+$/, '') || nomeArquivo;
}

/** Ponto único de entrada: detecta o formato pelo nome/mime e delega pro parser certo. */
export async function parseArquivo(arquivo: File): Promise<Documento> {
  const formato = detectarFormatoEntrada(arquivo);
  const nomeBase = semExtensao(arquivo.name);
  if (formato === 'md') return parseMarkdown(await arquivo.text(), nomeBase);
  if (formato === 'docx') return parseDocx(arquivo, nomeBase);
  if (formato === 'pdf') return parsePdf(arquivo, nomeBase);
  throw new Error('Unsupported file type. Upload a .pdf, .md or .docx file.');
}
