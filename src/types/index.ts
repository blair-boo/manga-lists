export type Tipo = 'Manga' | 'Manwha' | 'Manhua' | 'Novel';

export type StatusLeitura = 'To read' | 'Reading' | 'Complete' | 'Paused' | 'Dropped';

export type StatusPublicacao = 'Ongoing' | 'Completed' | 'One shot' | 'Hiatus' | 'Canceled';

export type StatusAprovacao = 'aprovado' | 'pendente' | 'rejeitado';

export type Estrategia = 'fetch_direto' | 'busca_workaround';

export type Categoria = 'tipo' | 'status_leitura' | 'status_publicacao' | 'rating' | 'genero' | 'tag';

export interface Obra {
  id: string;
  tipo: Tipo | null;
  titulo: string;
  titulos_alternativos: string[] | null;
  autor: string | null;
  capa_url: string | null;
  capitulo_atual: number | null;
  status_leitura: StatusLeitura | null;
  status_publicacao: StatusPublicacao | null;
  ultimo_capitulo_lancado: number | null;
  ultimo_capitulo_via_scraper: boolean;
  nota: number | null;
  generos: string[] | null;
  tags: string[] | null;
  observacoes: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface Fonte {
  id: string;
  obra_id: string;
  site: string | null;
  url: string;
  ultimo_capitulo_detectado: number | null;
  atualizado_por_scraper: boolean;
  confiavel: boolean;
  status_aprovacao: StatusAprovacao;
  descoberta_automaticamente: boolean;
  ultima_verificacao: string | null;
  criado_em: string;
}

export interface SiteSuportado {
  id: string;
  nome: string;
  url_base: string | null;
  estrategia: Estrategia;
  ativo: boolean;
}

export interface ListaItem {
  id: string;
  categoria: Categoria;
  valor: string;
}

export type ScraperTipo = 'capitulos' | 'fontes';
export type ScraperStatus = 'rodando' | 'concluido' | 'erro';

export interface ScraperRun {
  id: string;
  tipo: ScraperTipo;
  status: ScraperStatus;
  iniciado_em: string;
  finalizado_em: string | null;
  mensagem: string | null;
}

export type SyncEntity = 'obras' | 'fontes';
export type SyncOp = 'insert' | 'update' | 'delete';

export interface SyncQueueItem {
  id?: number;
  entity: SyncEntity;
  op: SyncOp;
  recordId: string;
  payload: Obra | Fonte | null;
  createdAt: string;
}
