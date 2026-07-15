-- Roda no SQL Editor do Supabase (projeto já provisionado).
--
-- Fluxo de designação de adaptadores (ver HANDOUT_ARQUITETURA_SCRAPERS):
-- quando um domínio novo entra em sites_suportados sem adaptador, o estágio
-- 'designar' (scraper/designar_adaptadores.py) roda a auto-detecção. Se algum
-- adaptador reconhece o site, grava o vínculo domínio->adaptador; se nenhum
-- reconhece, grava o relatório de diagnóstico em `diagnostico` para a fila de
-- aprovação mostrar "domínio sem adaptador".

-- 1. Relatório de diagnóstico por domínio (preenchido quando detect() volta None).
alter table sites_suportados
  add column if not exists diagnostico jsonb;

-- 2. scraper_runs aceita o novo tipo 'designar' (detecção/designação de adaptador).
alter table scraper_runs
  drop constraint if exists scraper_runs_tipo_check;

alter table scraper_runs
  add constraint scraper_runs_tipo_check
  check (tipo in ('capitulos', 'obras', 'fontes', 'designar'));
