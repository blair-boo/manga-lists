-- Roda no SQL Editor do Supabase (projeto já provisionado).
--
-- Marca que um hiato é, na verdade, fim de temporada (comum em manhwa/webtoon).
-- Coluna boolean separada, mantendo status_publicacao limpo para filtros.
-- Só faz sentido quando status_publicacao = 'Hiatus'; o app reseta para false
-- quando o status muda para outro valor.

alter table obras
  add column if not exists fim_de_temporada boolean not null default false;
