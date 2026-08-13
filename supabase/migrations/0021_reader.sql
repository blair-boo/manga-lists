-- Roda no SQL Editor do Supabase (projeto já provisionado).
--
-- Aba Reader (Fase 1) — download, formatação e leitura de novels.
--
-- A divisão que guia todo o desenho: DETECTAR é automático, BAIXAR é sempre
-- decisão da usuária. A varredura quinzenal (fase seguinte) só descobre
-- capítulos e datas de liberação do paywall; nada é baixado sem escolha
-- explícita da fonte. Por isso o estado 'descoberto' do capítulo é um estado
-- de ESPERA (acende 'disponivel' na obra), não uma fila de trabalho.
--
--   - reader_obras: uma linha por obra inscrita no Reader (1:1 com obras).
--     Guarda o pipeline, o resultado da última busca e os overrides da página
--     de informações (todos NULL = herda de obras).
--   - reader_fontes: grupo de tradução E origem de download — são o mesmo
--     dado visto de dois ângulos. O campo "Translation" da página de
--     informações ("1-150 Eternalune / 151-X Novelupdates") é derivado desta
--     tabela, não digitado à parte. Faixas sobrepostas são PERMITIDAS de
--     propósito: é justamente o caso em que a usuária escolhe de qual baixar.
--   - reader_capitulos: máquina de estados por capítulo. Idempotente por
--     (reader_obra_id, url), então revarrer não duplica.
--
-- As três tabelas têm atualizado_em + trigger porque o pull do app
-- (src/sync/sync.ts) precisa ser INCREMENTAL nelas. O outro padrão de pull do
-- repo (limpar e repovoar, usado em fontes) foi a causa real de linhas
-- "sumindo" acima de 1000 registros — ver os comentários em sync.ts — e
-- reader_capitulos passa de 1000 com poucas obras.

create table if not exists reader_obras (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null unique references obras(id) on delete cascade,

  -- Listas e pipeline
  concluido boolean not null default false,   -- decide In progress vs Completed
  busca_manual boolean not null default false, -- toggle "Search now"
  estado text not null default 'aguardando'
    check (estado in ('aguardando', 'disponivel', 'buscando', 'baixando', 'formatando', 'pronto')),
  estado_em timestamptz not null default now(),

  -- Última busca (três colunas, não jsonb: a UI mostra data e resultado lado a
  -- lado em cada linha da lista, e ultima_busca_ok vai ser filtrada depois)
  ultima_busca_em timestamptz,
  ultima_busca_ok boolean,
  ultima_busca_mensagem text,

  -- Totais declarados pelo site (o quanto foi baixado é contado dos capítulos)
  total_capitulos_site numeric,
  total_side_stories_site numeric,

  -- Página de informações: NULL = herda de obras. Colunas explícitas porque o
  -- conjunto é fixo e cada campo é editado e espelhado individualmente.
  -- Translation não entra aqui — é derivado de reader_fontes.
  info_titulo text,
  info_autor text,
  info_score numeric,
  info_status text,
  info_link text,
  info_sinopse text,
  info_generos text[],
  info_tags text[],

  -- Quais campos info_* devem também gravar na obra ao salvar.
  -- jsonb e não 8 booleanos: é um mapa aberto de flags, ex. {"titulo": true}.
  espelhar jsonb not null default '{}',

  -- Artefatos. O parcial (regenerado sozinho a cada leva de capítulos novos) é
  -- separado do final (gerado pelo botão, com capa e informações definitivas) —
  -- senão a próxima regeneração automática sobrescreveria a versão carimbada.
  pasta_storage text,
  capa_path text,
  epub_path text,
  epub_gerado_em timestamptz,
  epub_parcial_path text,
  epub_parcial_gerado_em timestamptz,
  pdf_path text,
  pdf_gerado_em timestamptz,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_reader_obras_obra_id on reader_obras(obra_id);
create index if not exists idx_reader_obras_concluido on reader_obras(concluido);

create table if not exists reader_fontes (
  id uuid primary key default gen_random_uuid(),
  reader_obra_id uuid not null references reader_obras(id) on delete cascade,
  grupo text not null,        -- nome do grupo de tradução / site
  url_indice text,            -- página com a lista de capítulos
  url_base text,
  de numeric,                 -- primeiro capítulo coberto por esta fonte
  ate numeric,                -- último; NULL = faixa aberta ("daqui pra frente")
  adaptador text,
  preferida boolean not null default false, -- default da tela de download; não impede a escolha
  ordem numeric,
  ativa boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_reader_fontes_reader_obra_id on reader_fontes(reader_obra_id);

create table if not exists reader_capitulos (
  id uuid primary key default gen_random_uuid(),
  reader_obra_id uuid not null references reader_obras(id) on delete cascade,
  -- Desnormalizado de propósito: deixa o cache local (Dexie) indexar capítulo
  -- por obra sem precisar de join.
  obra_id uuid not null references obras(id) on delete cascade,
  -- De qual fonte este capítulo veio; NULL enquanto só foi detectado.
  reader_fonte_id uuid references reader_fontes(id) on delete set null,

  numero numeric(10, 2),   -- numeric e não integer: capítulos .5 existem
  numero_texto text,       -- rótulo cru do site, ex. "Side Story 3", "Extra 2"
  titulo text,
  side_story boolean not null default false,
  -- Slot de ordenação explícito: side story não tem lugar no eixo do numero,
  -- então toda ordenação da UI passa por aqui, nunca por numero.
  ordem numeric,

  estado text not null default 'descoberto'
    check (estado in ('descoberto', 'bloqueado', 'baixado', 'formatado', 'publicado')),
  estado_em timestamptz not null default now(),

  disponivel_em date,  -- paywall: quando cai de graça (refinado a cada varredura)
  url text,
  path_md text,
  baixado_em timestamptz,
  formatado_em timestamptz,
  erro text,
  erro_em timestamptz,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  -- Mesma regra de identidade que `fontes` usa (unique (obra_id, url)): a
  -- numeração dos sites é confiável de menos pra ser chave, a URL identifica.
  unique (reader_obra_id, url)
);

create index if not exists idx_reader_capitulos_reader_obra_id on reader_capitulos(reader_obra_id);
create index if not exists idx_reader_capitulos_obra_id on reader_capitulos(obra_id);
create index if not exists idx_reader_capitulos_estado on reader_capitulos(estado);
create index if not exists idx_reader_capitulos_disponivel_em on reader_capitulos(disponivel_em);

-- Triggers de atualizado_em (função set_atualizado_em já existe no schema).
-- Sem eles o pull incremental do app não enxerga o que a varredura escrever.
drop trigger if exists trg_reader_obras_atualizado_em on reader_obras;
create trigger trg_reader_obras_atualizado_em
before update on reader_obras
for each row execute function set_atualizado_em();

drop trigger if exists trg_reader_fontes_atualizado_em on reader_fontes;
create trigger trg_reader_fontes_atualizado_em
before update on reader_fontes
for each row execute function set_atualizado_em();

drop trigger if exists trg_reader_capitulos_atualizado_em on reader_capitulos;
create trigger trg_reader_capitulos_atualizado_em
before update on reader_capitulos
for each row execute function set_atualizado_em();

alter table reader_obras enable row level security;

create policy "authenticated_full_access_reader_obras" on reader_obras
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

alter table reader_fontes enable row level security;

create policy "authenticated_full_access_reader_fontes" on reader_fontes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

alter table reader_capitulos enable row level security;

create policy "authenticated_full_access_reader_capitulos" on reader_capitulos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
