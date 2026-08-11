-- Modo 3 da importação CSV (Conciliação de sites relacionados, handout do
-- pedido "modos de importação"): casa título+link de uma planilha externa
-- (sources genéricas ou links de catálogo como NovelUpdates/AniList/etc.)
-- contra titulo/titulos_alternativos das obras já cadastradas, por
-- similaridade de título.
--
--   - conciliacao_pendentes: fila de aprovação dos matches na faixa 70-89%
--     (mesmo padrão de novelupdates_pendentes/fontes descoberta automática).
--   - conciliacao_blacklist: pares (obra, url) explicitamente rejeitados na
--     fila, pra não sugerir de novo o mesmo candidato pra mesma obra.

create table if not exists conciliacao_pendentes (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references obras(id) on delete cascade,
  titulo_candidato text not null,
  url_candidato text not null,
  score real not null,
  status_aprovacao text not null default 'pendente', -- 'pendente' | 'aprovado' | 'reprovado'
  criado_em timestamptz not null default now(),
  unique (obra_id, url_candidato)
);

create index if not exists idx_conciliacao_pendentes_status on conciliacao_pendentes(status_aprovacao);

create table if not exists conciliacao_blacklist (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references obras(id) on delete cascade,
  url text not null,
  criado_em timestamptz not null default now(),
  unique (obra_id, url)
);

alter table conciliacao_pendentes enable row level security;

create policy "authenticated_full_access_conciliacao_pendentes" on conciliacao_pendentes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

alter table conciliacao_blacklist enable row level security;

create policy "authenticated_full_access_conciliacao_blacklist" on conciliacao_blacklist
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
