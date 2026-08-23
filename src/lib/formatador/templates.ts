import type { Template } from './tipos';

/**
 * Templates embutidos — cada um define fonte, cor de destaque, tamanhos por
 * tipo de bloco e espaçamento de parágrafo, aplicados igual nos 4 exportadores
 * (MD só usa a estrutura; DOCX/PDF/EPUB usam tudo).
 */
export const TEMPLATES: Template[] = [
  {
    id: 'classico',
    nome: 'Classic',
    descricao: 'Serif, black on white, generous spacing — good for books and long text.',
    fonte: 'Georgia, "Times New Roman", serif',
    fontePdf: 'times',
    corDestaque: '#1a1a1a',
    tamanhosPt: { titulo: 26, h1: 20, h2: 16, h3: 13, paragrafo: 11, 'item-lista': 11, citacao: 11 },
    espacamentoParagraphoPt: 10,
  },
  {
    id: 'moderno',
    nome: 'Modern',
    descricao: 'Sans-serif with an accent color on headings — good for reports and docs.',
    fonte: 'Helvetica, Arial, sans-serif',
    fontePdf: 'helvetica',
    corDestaque: '#2563eb',
    tamanhosPt: { titulo: 28, h1: 19, h2: 15, h3: 12.5, paragrafo: 10.5, 'item-lista': 10.5, citacao: 10.5 },
    espacamentoParagraphoPt: 8,
  },
  {
    id: 'compacto',
    nome: 'Compact',
    descricao: 'Smaller sizes, tight spacing — fits the most content per page.',
    fonte: 'Helvetica, Arial, sans-serif',
    fontePdf: 'helvetica',
    corDestaque: '#333333',
    tamanhosPt: { titulo: 20, h1: 15, h2: 12.5, h3: 11, paragrafo: 9.5, 'item-lista': 9.5, citacao: 9.5 },
    espacamentoParagraphoPt: 5,
  },
];

export function buscarTemplate(id: string): Template {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}
