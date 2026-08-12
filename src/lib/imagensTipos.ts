/**
 * Tipos compartilhados da aba Images (Settings): tanto o fluxo de colar
 * links quanto o de subir arquivo (CSV/XLSX) alimentam a mesma lista, que
 * vira uma tabela de revisão editável antes de qualquer download começar.
 * Não é persistido (Dexie/localStorage) — ferramenta de import de uma
 * tacada só; recarregar a página no meio de um lote perde o progresso.
 */

export type OrigemImagem = 'colado' | 'arquivo';
export type StatusImagem = 'pendente' | 'baixando' | 'sucesso' | 'erro';

/** União extensível de propósito — adicionar 'google-drive' no futuro não muda o resto do modelo. */
export type Destino = 'local' | 'supabase';

export interface ItemImagem {
  id: string;
  url: string;
  nome: string;
  origem: OrigemImagem;
  status: StatusImagem;
  erro?: string;
  urlResultado?: string;
  tentativas: number;
}
