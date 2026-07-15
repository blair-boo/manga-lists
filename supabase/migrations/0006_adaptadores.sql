-- Roda no SQL Editor do Supabase (projeto já provisionado).
--
-- Arquitetura de scrapers por adaptador (ver HANDOUT_ARQUITETURA_SCRAPERS):
--   - adaptador: id do adaptador designado para o domínio (NULL = sem adaptador ainda).
--   - access_strategy: estratégia de acesso específica do domínio
--     ('http' | 'playwright' | 'flaresolverr'). Quando preenchida, sobrescreve o
--     padrão do adaptador; quando NULL, o domínio herda o padrão do adaptador.

alter table sites_suportados
  add column if not exists adaptador text;

alter table sites_suportados
  add column if not exists access_strategy text;

-- Preenche os domínios já conhecidos: mesmo motor (cms-generico), acessos
-- diferentes — nyxscans funciona por HTTP direto; ezmanga está atrás de
-- Cloudflare, então marca-se flaresolverr (retorna 'acesso_bloqueado' até haver
-- solver configurado, e é o comportamento esperado).
update sites_suportados set adaptador = 'cms-generico', access_strategy = 'http'
  where nome = 'nyxscans' and adaptador is null;

update sites_suportados set adaptador = 'cms-generico', access_strategy = 'flaresolverr'
  where nome = 'ezmanga' and adaptador is null;
