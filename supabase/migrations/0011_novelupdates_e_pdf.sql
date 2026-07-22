-- Roda no SQL Editor do Supabase (projeto já provisionado).
--
-- HANDOUT 3 — Novel Updates (Bloco E1) + checkbox PDF (Bloco F1):
--   - obras.novelupdates_url: link canônico da página no Novel Updates quando a
--     obra está vinculada (NULL quando não vinculada). Espelhado entre obras
--     vinculadas manga<->novel pelo front (CAMPOS_ESPELHADOS) e manualmente pelo
--     scraper Python.
--   - obras.pdf: a obra tem PDF? Independente por obra (NÃO espelhado).
--   - novelupdates_pendentes: fila de aprovação dos matches não-exatos do scraper
--     de Novel Updates (espelha o padrão da fila de fontes descobertas).
--   - scraper_runs.tipo: aceita o novo estágio 'novelupdates'.

alter table obras
  add column if not exists novelupdates_url text;

alter table obras
  add column if not exists pdf boolean not null default false;

create table if not exists novelupdates_pendentes (
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

create index if not exists idx_novelupdates_pendentes_status on novelupdates_pendentes(status_aprovacao);

alter table novelupdates_pendentes enable row level security;

create policy "authenticated_full_access_novelupdates_pendentes" on novelupdates_pendentes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- scraper_runs.tipo passa a aceitar 'novelupdates' (estágio próprio na aba Updates).
alter table scraper_runs drop constraint if exists scraper_runs_tipo_check;
alter table scraper_runs
  add constraint scraper_runs_tipo_check
  check (tipo in ('capitulos', 'obras', 'fontes', 'designar', 'novelupdates'));
