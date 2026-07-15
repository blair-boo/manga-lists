-- Schema: Controle de Leitura (Manga/Manwha/Manhua/Novel)
-- Supabase / Postgres

create extension if not exists "pgcrypto";

create table obras (
    id uuid primary key default gen_random_uuid(),
    tipo text, -- 'Manga' | 'Manwha' | 'Manhua' | 'Novel'
    titulo text not null,
    titulos_alternativos text[],
    autor text,
    capa_url text,
    capitulo_atual numeric,
    status_leitura text, -- 'To read' | 'Reading' | 'Complete' | 'Paused' | 'Dropped'
    status_publicacao text, -- 'Ongoing' | 'Completed' | 'One shot' | 'Hiatus' | 'Canceled'
    fim_de_temporada boolean not null default false, -- só relevante quando status_publicacao = 'Hiatus'
    ultimo_capitulo_lancado numeric,
    ultimo_capitulo_via_scraper boolean not null default false,
    nota int check (nota between 1 and 5),
    generos text[],
    tags text[],
    observacoes text,
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
    diagnostico jsonb -- relatório do modo diagnóstico quando nenhum adaptador se designou (NULL = designado/ok)
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
    tipo text not null check (tipo in ('capitulos', 'obras', 'fontes', 'designar')),
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

create index idx_fontes_obra_id on fontes(obra_id);
create index idx_fontes_status_aprovacao on fontes(status_aprovacao);
create index idx_obras_titulo on obras(titulo);
create index idx_listas_categoria on listas(categoria);

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
