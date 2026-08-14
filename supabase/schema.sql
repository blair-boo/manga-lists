-- Schema: Controle de Leitura (Manga/Manhwa/Manhua/Novel)
-- Supabase / Postgres

create extension if not exists "pgcrypto";

create table obras (
    id uuid primary key default gen_random_uuid(),
    tipo text, -- 'Manga' | 'Manhwa' | 'Manhua' | 'Novel'
    titulo text not null,
    titulos_alternativos text[],
    autor text,
    capa_url text,
    capitulo_atual numeric,
    status_leitura text, -- 'To read' | 'Reading' | 'Finished' | 'Paused' | 'Dropped' | 'Re-read'
    status_publicacao text, -- 'Ongoing' | 'Completed' | 'One shot' | 'Hiatus' | 'Canceled'
    fim_de_temporada boolean not null default false, -- só relevante quando status_publicacao = 'Hiatus'
    ultimo_capitulo_lancado numeric,
    ultimo_capitulo_via_scraper boolean not null default false,
    score int check (score between 1 and 5),
    generos text[],
    tags text[],
    observacoes text,
    obra_vinculada_id uuid references obras(id) on delete set null, -- manga<->novel da mesma história (mútuo)
    novelupdates_url text, -- link canônico da página no Novel Updates (NULL = não vinculada); espelhado entre vinculadas
    pdf boolean not null default false, -- a obra tem PDF? independente por obra (não espelhado)
    favorito boolean not null default false, -- marcada como favorita, independente por obra (não espelhado)
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now()
);

create table sites_suportados (
    id uuid primary key default gen_random_uuid(),
    nome text not null unique,
    url_base text,
    estrategia text not null default 'fetch_direto', -- informativo; o scraper roteia por host (parser dedicado p/ nyxscans)
    ativo boolean not null default true,
    adaptador text, -- id do adaptador designado (NULL = sem adaptador ainda)
    access_strategy text, -- 'http' | 'playwright' | 'flaresolverr'; sobrescreve o padrão do adaptador
    diagnostico jsonb, -- relatório do modo diagnóstico quando nenhum adaptador se designou (NULL = designado/ok)
    criado_em timestamptz not null default now() -- quando o domínio foi pedido (fila de aprovação mostra "requested")
);

create table fontes (
    id uuid primary key default gen_random_uuid(),
    obra_id uuid not null references obras(id) on delete cascade,
    site text,
    url text not null,
    ultimo_capitulo_detectado numeric,
    atualizado_por_scraper boolean not null default false,
    confiavel boolean not null default true,
    status_aprovacao text not null default 'aprovado', -- 'aprovado' | 'pendente' | 'rejeitado'
    descoberta_automaticamente boolean not null default false,
    ultima_verificacao timestamptz,
    tipo_detectado text check (tipo_detectado in ('manga', 'novel')), -- hierarquia de sinais (URL > título > og:type)
    tipo_manual boolean not null default false, -- true = decisão manual; o scraper nunca sobrescreve
    criado_em timestamptz not null default now()
);

create table listas (
    id uuid primary key default gen_random_uuid(),
    categoria text not null, -- 'tipo' | 'status_leitura' | 'status_publicacao' | 'rating' | 'genero' | 'tag'
    valor text not null,
    unique (categoria, valor)
);

create table scraper_runs (
    id uuid primary key default gen_random_uuid(),
    tipo text not null check (tipo in ('capitulos', 'obras', 'fontes', 'designar', 'novelupdates', 'reader')),
    status text not null default 'rodando', -- 'rodando' | 'concluido' | 'erro'
    site_dominio text, -- nulo p/ 'capitulos'/'fontes' (globais); preenchido por 'obras'
    iniciado_em timestamptz not null default now(),
    finalizado_em timestamptz,
    mensagem text
);

-- Blacklist de domínios: usada pela descoberta de fontes (discover_fontes.py)
-- para nunca sugerir de novo um site inteiro. Diferente de 'rejeitado', que é
-- por fonte específica.
create table dominios_bloqueados (
    id uuid primary key default gen_random_uuid(),
    dominio text not null unique,
    motivo text,
    criado_em timestamptz not null default now()
);

-- Configurações dos scrapers lidas em runtime (sem redeploy). Hoje guarda os
-- limiares de similaridade de título (chave 'match_titulo').
create table configuracoes_scraper (
    chave text primary key,
    valor jsonb not null,
    atualizado_em timestamptz not null default now()
);

-- Fila de aprovação do scraper de Novel Updates (Handout 3, Bloco E5): matches
-- não-exatos (score entre o limiar mínimo e o de auto-aprovação) esperam curadoria
-- manual aqui antes de gravar novelupdates_url na obra. Espelha o padrão da fila
-- de fontes descobertas automaticamente.
create table novelupdates_pendentes (
    id uuid primary key default gen_random_uuid(),
    obra_id uuid not null references obras(id) on delete cascade,
    novelupdates_url text not null,
    titulo_encontrado text not null,      -- título como aparece no NU (og:title)
    score real not null,                  -- score do match de título (rapidfuzz)
    titulos_associados text[],            -- Associated Names extraídos (p/ enriquecer Alternative titles ao aprovar)
    status_aprovacao text not null default 'pendente', -- 'pendente' | 'aprovado' | 'reprovado'
    criado_em timestamptz not null default now(),
    unique (obra_id)
);

create index idx_novelupdates_pendentes_status on novelupdates_pendentes(status_aprovacao);

-- Fila de aprovação do Modo 3 da importação CSV (Conciliação de sites
-- relacionados): matches na faixa 70-89% entre título/títulos alternativos
-- de uma obra e uma linha (título, link) de uma planilha externa.
create table conciliacao_pendentes (
    id uuid primary key default gen_random_uuid(),
    obra_id uuid not null references obras(id) on delete cascade,
    titulo_candidato text not null,
    url_candidato text not null,
    score real not null,
    status_aprovacao text not null default 'pendente', -- 'pendente' | 'aprovado' | 'reprovado'
    criado_em timestamptz not null default now(),
    unique (obra_id, url_candidato)
);

create index idx_conciliacao_pendentes_status on conciliacao_pendentes(status_aprovacao);

-- Pares (obra, url) rejeitados na fila do Modo 3: não sugere de novo o mesmo
-- candidato pra mesma obra numa importação futura.
create table conciliacao_blacklist (
    id uuid primary key default gen_random_uuid(),
    obra_id uuid not null references obras(id) on delete cascade,
    url text not null,
    criado_em timestamptz not null default now(),
    unique (obra_id, url)
);

-- ---------------------------------------------------------------------------
-- Reader — download, formatação e leitura de novels (migration 0021)
--
-- A divisão que guia o desenho: DETECTAR é automático, BAIXAR é sempre decisão
-- da usuária. A varredura quinzenal só descobre capítulos e datas de liberação
-- do paywall; nada é baixado sem escolha explícita da fonte. Por isso o estado
-- 'descoberto' do capítulo é um estado de ESPERA (acende 'disponivel' na obra),
-- não uma fila de trabalho.
-- ---------------------------------------------------------------------------

-- Uma linha por obra inscrita no Reader (1:1 com obras).
create table reader_obras (
    id uuid primary key default gen_random_uuid(),
    obra_id uuid not null unique references obras(id) on delete cascade,
    concluido boolean not null default false,    -- decide In progress vs Completed
    busca_manual boolean not null default false, -- toggle "Search now"
    estado text not null default 'aguardando'
      check (estado in ('aguardando', 'disponivel', 'buscando', 'baixando', 'formatando', 'pronto')),
    estado_em timestamptz not null default now(),
    -- Última busca em três colunas (não jsonb): a UI mostra data e resultado
    -- lado a lado em cada linha, e ultima_busca_ok vai ser filtrada depois.
    ultima_busca_em timestamptz,
    ultima_busca_ok boolean,
    ultima_busca_mensagem text,
    total_capitulos_site numeric,      -- total declarado pelo site
    total_side_stories_site numeric,
    -- Página de informações: NULL = herda de obras. Colunas explícitas porque o
    -- conjunto é fixo e cada campo é editado/espelhado individualmente.
    -- Translation não entra aqui — é derivado de reader_fontes.
    info_titulo text,
    info_autor text,
    info_score numeric,
    info_status text,
    info_link text,
    info_sinopse text,
    info_generos text[],
    info_tags text[],
    -- Quais campos info_* também gravam na obra ao salvar, ex. {"titulo": true}.
    espelhar jsonb not null default '{}',
    -- Artefatos. O parcial (regenerado sozinho a cada leva nova) é separado do
    -- final (gerado pelo botão) — senão a regeneração automática sobrescreveria
    -- a versão carimbada.
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

-- Grupo de tradução E origem de download — são o mesmo dado visto de dois
-- ângulos. O campo "Translation" da página de informações ("1-150 Eternalune /
-- 151-X Novelupdates") é derivado desta tabela, não digitado à parte. Faixas
-- sobrepostas são PERMITIDAS de propósito: é o caso em que a usuária escolhe
-- de qual fonte baixar; `preferida` só marca o default da tela.
create table reader_fontes (
    id uuid primary key default gen_random_uuid(),
    reader_obra_id uuid not null references reader_obras(id) on delete cascade,
    grupo text not null,
    url_indice text,     -- página com a lista de capítulos
    url_base text,
    de numeric,          -- primeiro capítulo coberto
    ate numeric,         -- último; NULL = faixa aberta ("daqui pra frente")
    adaptador text,
    preferida boolean not null default false,
    ordem numeric,
    ativa boolean not null default true,
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now()
);

-- Máquina de estados por capítulo. Idempotente por (reader_obra_id, url):
-- revarrer não duplica.
create table reader_capitulos (
    id uuid primary key default gen_random_uuid(),
    reader_obra_id uuid not null references reader_obras(id) on delete cascade,
    -- Desnormalizado de propósito: deixa o cache local (Dexie) indexar capítulo
    -- por obra sem precisar de join.
    obra_id uuid not null references obras(id) on delete cascade,
    reader_fonte_id uuid references reader_fontes(id) on delete set null,
    -- Identidade do capítulo dentro da obra: o número normalizado a partir do
    -- rótulo do site ("Chapter 143.2" -> '143.2', "Side Story 3" -> 'ss-3').
    -- NÃO é a URL: nos temas Madara o capítulo atrás de paywall vem com
    -- href="#" e só ganha URL quando o paywall cai, então usar URL duplicaria
    -- os bloqueados e perderia o vínculo na liberação (ver migration 0022).
    chave text not null,
    -- Id do capítulo no site quando existir (Madara: data-chapter-14124).
    -- Não é chave — só os bloqueados o expõem —, serve pra casar e depurar.
    id_externo text,
    numero numeric(10, 2),  -- numeric e não integer: capítulos .5 existem
    numero_texto text,      -- rótulo cru do site, ex. "Side Story 3"
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
    -- É esta constraint que torna a varredura idempotente: revarrer atualiza a
    -- linha existente (upsert por chave) em vez de duplicar.
    unique (reader_obra_id, chave)
);

create index idx_fontes_obra_id on fontes(obra_id);
create index idx_fontes_status_aprovacao on fontes(status_aprovacao);
create index idx_obras_titulo on obras(titulo);
create index idx_listas_categoria on listas(categoria);
create index idx_reader_obras_obra_id on reader_obras(obra_id);
create index idx_reader_obras_concluido on reader_obras(concluido);
create index idx_reader_fontes_reader_obra_id on reader_fontes(reader_obra_id);
create index idx_reader_capitulos_reader_obra_id on reader_capitulos(reader_obra_id);
create index idx_reader_capitulos_obra_id on reader_capitulos(obra_id);
create index idx_reader_capitulos_estado on reader_capitulos(estado);
create index idx_reader_capitulos_disponivel_em on reader_capitulos(disponivel_em);

-- Trigger para manter atualizado_em em obras
create or replace function set_atualizado_em()
returns trigger as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_obras_atualizado_em
before update on obras
for each row execute function set_atualizado_em();

-- As três tabelas do Reader precisam de atualizado_em porque o pull do app
-- (src/sync/sync.ts) é INCREMENTAL nelas. O outro padrão de pull do repo
-- (limpar e repovoar, usado em fontes) foi a causa real de linhas "sumindo"
-- acima de 1000 registros, e reader_capitulos passa disso com poucas obras.
create trigger trg_reader_obras_atualizado_em
before update on reader_obras
for each row execute function set_atualizado_em();

create trigger trg_reader_fontes_atualizado_em
before update on reader_fontes
for each row execute function set_atualizado_em();

create trigger trg_reader_capitulos_atualizado_em
before update on reader_capitulos
for each row execute function set_atualizado_em();

-- Seed inicial de sites_suportados (ajustar conforme necessário)
-- Obs: nyxscans tem parser dedicado no scraper (lê o payload embutido do
-- Next.js via requests simples), então não precisa mais de 'busca_workaround'
-- nem de Playwright.
insert into sites_suportados (nome, url_base, estrategia) values
    ('ezmanga', 'https://ezmanga.org', 'fetch_direto'),
    ('nyxscans', 'https://nyxscans.com', 'fetch_direto');

-- ---------------------------------------------------------------------------
-- Segurança (RLS)
--
-- Este app é publicado como site estático (GitHub Pages) e usa a chave
-- "anon" do Supabase diretamente no bundle JS, o que significa que ela é
-- pública para qualquer pessoa que inspecionar o site. Sem RLS, qualquer
-- um com essa chave poderia ler/escrever livremente nas tabelas.
--
-- A política abaixo exige um usuário autenticado (Supabase Auth) para
-- qualquer operação. Crie seu próprio usuário em Authentication > Users
-- no painel do Supabase (ou habilite signups e crie pela tela de login do
-- app na primeira vez) — como é uso pessoal, não há necessidade de
-- diferenciar "dono" por linha, apenas exigir login.
-- ---------------------------------------------------------------------------

alter table obras enable row level security;
alter table fontes enable row level security;
alter table sites_suportados enable row level security;
alter table listas enable row level security;

create policy "authenticated_full_access_obras" on obras
    for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated_full_access_fontes" on fontes
    for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated_full_access_sites_suportados" on sites_suportados
    for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated_full_access_listas" on listas
    for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

alter table scraper_runs enable row level security;

create policy "authenticated_full_access_scraper_runs" on scraper_runs
    for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

alter table novelupdates_pendentes enable row level security;

create policy "authenticated_full_access_novelupdates_pendentes" on novelupdates_pendentes
    for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

alter table conciliacao_pendentes enable row level security;

create policy "authenticated_full_access_conciliacao_pendentes" on conciliacao_pendentes
    for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

alter table conciliacao_blacklist enable row level security;

create policy "authenticated_full_access_conciliacao_blacklist" on conciliacao_blacklist
    for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

alter table reader_obras enable row level security;
alter table reader_fontes enable row level security;
alter table reader_capitulos enable row level security;

create policy "authenticated_full_access_reader_obras" on reader_obras
    for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated_full_access_reader_fontes" on reader_fontes
    for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated_full_access_reader_capitulos" on reader_capitulos
    for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
