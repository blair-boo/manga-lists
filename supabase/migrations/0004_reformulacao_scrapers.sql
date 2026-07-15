-- Roda no SQL Editor do Supabase (projeto já provisionado).
--
-- Fase 1 da reformulação dos scrapers:
--   1. scraper_runs ganha coluna site_dominio e passa a aceitar o tipo 'obras'.
--   2. Tabela nova dominios_bloqueados (blacklist de domínios p/ a descoberta).
--   3. Tabela nova configuracoes_scraper (limiares de match de título ajustáveis).
--
-- Obs: mantemos os status de fonte atuais ('aprovado' | 'pendente' | 'rejeitado').
-- "Reprovar" uma fonte = deixá-la 'rejeitado' (já existe). Blacklist é por domínio,
-- um mecanismo à parte (abaixo).

-- 1. scraper_runs: site_dominio + tipo 'obras' ------------------------------

alter table scraper_runs
  add column if not exists site_dominio text;

-- site_dominio fica nulo para 'capitulos' e 'fontes' (buscas globais); é
-- preenchido por 'obras' (varredura por site). Hoje não há constraint de tipo;
-- adicionamos uma que inclui 'obras'.
alter table scraper_runs
  drop constraint if exists scraper_runs_tipo_check;

alter table scraper_runs
  add constraint scraper_runs_tipo_check
  check (tipo in ('capitulos', 'obras', 'fontes'));

-- 2. dominios_bloqueados (blacklist) ----------------------------------------
--
-- Usada exclusivamente pelo fluxo de "Buscar novas fontes" (discover_fontes.py):
-- qualquer resultado do fallback de busca web cujo domínio esteja aqui é
-- ignorado. Diferente de 'rejeitado' (que é por fonte específica), isto é por
-- domínio inteiro ("esse site nunca deve ser sugerido de novo").

create table if not exists dominios_bloqueados (
    id uuid primary key default gen_random_uuid(),
    dominio text not null unique,
    motivo text,
    criado_em timestamptz not null default now()
);

alter table dominios_bloqueados enable row level security;

create policy "authenticated_full_access_dominios_bloqueados" on dominios_bloqueados
    for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 3. configuracoes_scraper (limiares de match de título) --------------------
--
-- Os scripts leem esses limiares do Supabase no início da execução (não ficam
-- fixos no código Python), permitindo ajuste pela usuária sem novo deploy.
--   limiar_auto_aprovacao  : score >= => fonte entra já 'aprovado'
--   limiar_minimo_pendencia: score >= (e < auto) => fonte entra 'pendente'
--   score <  limiar_minimo_pendencia => descarta sem registrar

create table if not exists configuracoes_scraper (
    chave text primary key,
    valor jsonb not null,
    atualizado_em timestamptz not null default now()
);

alter table configuracoes_scraper enable row level security;

create policy "authenticated_full_access_configuracoes_scraper" on configuracoes_scraper
    for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

insert into configuracoes_scraper (chave, valor) values (
  'match_titulo',
  '{
    "atualizar_obras": {
      "limiar_auto_aprovacao": 0.95,
      "limiar_minimo_pendencia": 0.70
    },
    "buscar_novas_fontes": {
      "limiar_auto_aprovacao": 0.95,
      "limiar_minimo_pendencia": 0.85
    }
  }'::jsonb
)
on conflict (chave) do nothing;
