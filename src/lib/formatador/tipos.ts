/**
 * Modelo intermediário comum entre os 3 formatos de entrada (PDF/MD/Word) e os
 * 4 formatos de saída (MD/Word/PDF/EPUB): todo parser converte pra `Documento`
 * e todo exportador parte dele, então adicionar um novo formato de cada lado
 * não exige tocar nos outros.
 */

export type TipoBloco = 'h1' | 'h2' | 'h3' | 'paragrafo' | 'item-lista' | 'citacao';

export interface Bloco {
  tipo: TipoBloco;
  texto: string;
}

export interface Documento {
  titulo: string;
  blocos: Bloco[];
}

export interface Template {
  id: string;
  nome: string;
  descricao: string;
  /** Família de fonte pro DOCX/PDF/EPUB (nome usado no DOCX/PDF; pilha CSS no EPUB). */
  fonte: string;
  fontePdf: 'helvetica' | 'times' | 'courier';
  corDestaque: string;
  tamanhosPt: Record<'titulo' | TipoBloco, number>;
  espacamentoParagraphoPt: number;
}
