import type { Template } from './tipos';
import { parseTemplateDocxBuffer } from './parseTemplateDocx';

const CHAVE_STORAGE = 'format-template-customizado-v1';

export function carregarTemplateCustomizadoSalvo(): Template | null {
  try {
    const bruto = localStorage.getItem(CHAVE_STORAGE);
    return bruto ? (JSON.parse(bruto) as Template) : null;
  } catch {
    return null;
  }
}

export function salvarTemplateCustomizado(template: Template): void {
  try {
    localStorage.setItem(CHAVE_STORAGE, JSON.stringify(template));
  } catch {
    // Best-effort: sem persistência o template substituído ainda funciona nesta sessão.
  }
}

export function limparTemplateCustomizadoSalvo(): void {
  try {
    localStorage.removeItem(CHAVE_STORAGE);
  } catch {
    // Idem: falha ao limpar não impede resetar em memória.
  }
}

/** Template padrão embutido (ebook_template.docx) — ponto de partida antes de qualquer substituição. */
export async function carregarTemplatePadrao(): Promise<Template> {
  const url = (await import('../../assets/templates/ebook-template.docx?url')).default;
  const resposta = await fetch(url);
  const arrayBuffer = await resposta.arrayBuffer();
  const template = await parseTemplateDocxBuffer(arrayBuffer, 'Ebook template');
  return { ...template, descricao: 'Default template, from the bundled ebook_template.docx.' };
}
