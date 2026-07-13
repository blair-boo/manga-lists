-- Roda no SQL Editor do Supabase (projeto já provisionado).
-- Rastreia se o último capítulo veio do scraper ou de edição manual,
-- e cria a tabela de status das execuções do scraper.

alter table fontes add column if not exists atualizado_por_scraper boolean not null default false;
alter table obras add column if not exists ultimo_capitulo_via_scraper boolean not null default false;

create table if not exists scraper_runs (
    id uuid primary key default gen_random_uuid(),
    tipo text not null,
    status text not null default 'rodando',
    iniciado_em timestamptz not null default now(),
    finalizado_em timestamptz,
    mensagem text
);

alter table scraper_runs enable row level security;

-- Se der erro "already exists" aqui, é porque já rodou antes: pode ignorar.
create policy "authenticated_full_access_scraper_runs" on scraper_runs
    for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
