-- Roda no SQL Editor do Supabase (projeto já provisionado).
--
-- obras.status_publicacao_manual: quando true, o status de publicação foi
-- definido manualmente pela usuária (form de edição, cadastro, ou CSV bulk
-- update) — o scraper (update_fontes.py, status_publicacao_detectado do
-- comix) nunca sobrescreve. Mesmo padrão de fontes.tipo_manual (migração
-- 0008, Bloco B4): a decisão manual da usuária sempre vence.

alter table obras
  add column if not exists status_publicacao_manual boolean not null default false;
