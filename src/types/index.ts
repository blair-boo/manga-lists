export type Tipo = 'Manga' | 'Manhwa' | 'Manhua' | 'Novel';

export type StatusLeitura = 'To read' | 'Reading' | 'Finished' | 'Paused' | 'Dropped' | 'Re-read';

export type StatusPublicacao = 'Ongoing' | 'Completed' | 'One shot' | 'Hiatus' | 'Canceled';

export type StatusAprovacao = 'aprovado' | 'pendente' | 'rejeitado';

/** Classificação indicativa da obra (nenhuma quando null). */
export type Classificacao = 'R-15' | 'R-18';

export type Estrategia = 'fetch_direto' | 'busca_workaround';

export type Categoria = 'tipo' | 'status_leitura' | 'status_publicacao' | 'rating' | 'genero' | 'tag';

/** 'manga' cobre Manga/Manhwa/Manhua para efeito de fontes (handout consolidado, Bloco B0). */
export type FamiliaTipo = 'manga' | 'novel';

export interface Obra {
  id: string;
  tipo: Tipo | null;
  titulo: string;
  titulos_alternativos: string[] | null;
  autor: string | null;
  /** Artistas da obra (desenho), separado de `autor` (roteiro). Texto livre, nomes separados por vírgula. */
  artistas: string | null;
  capa_url: string | null;
  capitulo_atual: number | null;
  status_leitura: StatusLeitura | null;
  status_publicacao: StatusPublicacao | null;
  /** Quando true, status_publicacao foi definido manualmente — o scraper (status do comix) nunca sobrescreve. */
  status_publicacao_manual: boolean;
  fim_de_temporada: boolean;
  ultimo_capitulo_lancado: number | null;
  ultimo_capitulo_via_scraper: boolean;
  score: number | null;
  generos: string[] | null;
  tags: string[] | null;
  observacoes: string | null;
  /** Obra correspondente (manga<->novel da mesma história) — Title/Alternative Title são espelhados. */
  obra_vinculada_id: string | null;
  /** Classificação indicativa (R-15 / R-18 / null). */
  classificacao: Classificacao | null;
  /** Link canônico da página no Novel Updates (null = não vinculada). Espelhado entre obras vinculadas. */
  novelupdates_url: string | null;
  /** Links externos de catálogo. Mesmo modelo de novelupdates_url: campo, não fonte. Espelhados entre obras vinculadas. */
  anilist_url: string | null;
  myanimelist_url: string | null;
  mangaupdates_url: string | null;
  mangadex_url: string | null;
  mangabaka_url: string | null;
  /** A obra tem PDF? Independente por obra (não espelhado). */
  pdf: boolean;
  /** Marcada como favorita (Handout favoritos). Independente por obra, não espelhada. */
  favorito: boolean;
  criado_em: string;
  atualizado_em: string;
}

/** Match de Novel Updates aguardando aprovação manual (Handout 3, Bloco E5). */
export interface NovelUpdatesPendente {
  id: string;
  obra_id: string;
  novelupdates_url: string;
  titulo_encontrado: string;
  score: number;
  titulos_associados: string[] | null;
  status_aprovacao: 'pendente' | 'aprovado' | 'reprovado';
  criado_em: string;
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
  /** Tipo detectado pela hierarquia de sinais (URL > título > og:type) — Bloco B1. */
  tipo_detectado: FamiliaTipo | null;
  /** Quando true, a usuária decidiu o tipo/obra manualmente — o scraper nunca sobrescreve (B4). */
  tipo_manual: boolean;
  /** Ordem manual dentro da obra (menor primeiro); null = legada, cai por último. */
  ordem: number | null;
}

export interface DiagnosticoEntrada {
  adapter_id: string;
  matched: boolean;
  parse_status: string;
  mensagem: string;
}

export interface DiagnosticoAdaptador {
  gerado_em: string;
  entradas: DiagnosticoEntrada[];
}

export interface SiteSuportado {
  id: string;
  nome: string;
  url_base: string | null;
  estrategia: Estrategia;
  ativo: boolean;
  adaptador: string | null;
  access_strategy: string | null;
  diagnostico: DiagnosticoAdaptador | null;
}

export interface ListaItem {
  id: string;
  categoria: Categoria;
  valor: string;
}

export type ScraperTipo = 'capitulos' | 'obras' | 'fontes' | 'designar' | 'novelupdates';
export type ScraperStatus = 'rodando' | 'concluido' | 'erro' | 'nao_suportado' | 'sem_adaptador';

export interface ScraperRun {
  id: string;
  tipo: ScraperTipo;
  status: ScraperStatus;
  site_dominio: string | null;
  iniciado_em: string;
  finalizado_em: string | null;
  mensagem: string | null;
  resumo: Record<string, number> | null;
}

// ---------------------------------------------------------------------------
// Reader — download, formatação e leitura de novels.
//
// A divisão que guia o desenho: DETECTAR é automático, BAIXAR é sempre decisão
// da usuária. Por isso 'descoberto' é um estado de ESPERA (acende 'disponivel'
// na obra), não uma fila de trabalho que alguém vai consumir sozinho.
// ---------------------------------------------------------------------------

export type ReaderEstadoObra = 'aguardando' | 'disponivel' | 'buscando' | 'baixando' | 'formatando' | 'pronto';

export type ReaderEstadoCapitulo = 'descoberto' | 'bloqueado' | 'baixado' | 'formatado' | 'publicado';

/** Campos da página de informações que podem também gravar no cadastro da obra. */
export type CampoInfoReader = 'titulo' | 'autor' | 'score' | 'status' | 'generos' | 'tags' | 'link' | 'sinopse';

export interface ReaderObra {
  id: string;
  obra_id: string;
  /** Decide em qual das duas listas a obra aparece (In progress / Completed). */
  concluido: boolean;
  /** Toggle "Search now" — pede uma varredura fora da cadência quinzenal. */
  busca_manual: boolean;
  estado: ReaderEstadoObra;
  estado_em: string;
  ultima_busca_em: string | null;
  ultima_busca_ok: boolean | null;
  ultima_busca_mensagem: string | null;
  /** Totais declarados pelo site (o quanto foi baixado é contado dos capítulos). */
  total_capitulos_site: number | null;
  total_side_stories_site: number | null;
  /** Overrides da página de informações — null = herda de `obras`. */
  info_titulo: string | null;
  info_autor: string | null;
  info_score: number | null;
  info_status: string | null;
  info_link: string | null;
  info_sinopse: string | null;
  info_generos: string[] | null;
  info_tags: string[] | null;
  /** Quais campos info_* também gravam na obra ao salvar. */
  espelhar: Partial<Record<CampoInfoReader, boolean>>;
  pasta_storage: string | null;
  capa_path: string | null;
  /** EPUB final, carimbado pelo botão. Separado do parcial pra não ser sobrescrito. */
  epub_path: string | null;
  epub_gerado_em: string | null;
  /** EPUB parcial, regenerado sozinho a cada leva de capítulos novos. */
  epub_parcial_path: string | null;
  epub_parcial_gerado_em: string | null;
  pdf_path: string | null;
  pdf_gerado_em: string | null;
  criado_em: string;
  atualizado_em: string;
}

/**
 * Grupo de tradução E origem de download — o mesmo dado visto de dois ângulos.
 * O campo "Translation" da página de informações é derivado daqui.
 * Faixas sobrepostas são permitidas: é o caso em que a usuária escolhe.
 */
export interface ReaderFonte {
  id: string;
  reader_obra_id: string;
  grupo: string;
  /** Página com a lista de capítulos. */
  url_indice: string | null;
  url_base: string | null;
  /** Primeiro capítulo coberto por esta fonte. */
  de: number | null;
  /** Último capítulo coberto; null = faixa aberta ("daqui pra frente"). */
  ate: number | null;
  adaptador: string | null;
  /** Default da tela de download — não impede escolher outra. */
  preferida: boolean;
  ordem: number | null;
  ativa: boolean;
  criado_em: string;
  atualizado_em: string;
}

export interface ReaderCapitulo {
  id: string;
  reader_obra_id: string;
  /** Desnormalizado: deixa o Dexie indexar capítulo por obra sem join. */
  obra_id: string;
  /** De qual fonte veio; null enquanto só foi detectado. */
  reader_fonte_id: string | null;
  /**
   * Identidade do capítulo dentro da obra — número normalizado ('143.2',
   * 'ss-3'). NÃO é a URL: capítulo atrás de paywall vem sem URL e só ganha uma
   * quando o paywall cai (ver migration 0022). Derivada por `chaveCapitulo`.
   */
  chave: string;
  /** Id do capítulo no site, quando ele expõe um (Madara: data-chapter-N). */
  id_externo: string | null;
  numero: number | null;
  /** Rótulo cru do site, ex. "Side Story 3" — preserva o que a numeração perde. */
  numero_texto: string | null;
  titulo: string | null;
  side_story: boolean;
  /** Slot de ordenação explícito: side story não tem lugar no eixo do `numero`. */
  ordem: number | null;
  estado: ReaderEstadoCapitulo;
  estado_em: string;
  /** Paywall: data em que cai de graça (refinada a cada varredura). */
  disponivel_em: string | null;
  url: string | null;
  path_md: string | null;
  baixado_em: string | null;
  formatado_em: string | null;
  erro: string | null;
  erro_em: string | null;
  criado_em: string;
  atualizado_em: string;
}

export type SyncEntity = 'obras' | 'fontes' | 'reader_obras' | 'reader_fontes' | 'reader_capitulos';
export type SyncOp = 'insert' | 'update' | 'delete';

export interface SyncQueueItem {
  id?: number;
  entity: SyncEntity;
  op: SyncOp;
  recordId: string;
  payload: Obra | Fonte | ReaderObra | ReaderFonte | ReaderCapitulo | null;
  createdAt: string;
}
