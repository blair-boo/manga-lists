-- Rodar manualmente no SQL Editor do Supabase.
--
-- Favoritos: marcação independente por obra (não espelhada entre obras
-- vinculadas manga<->novel), mesmo modelo do campo pdf.
alter table obras add column if not exists favorito boolean not null default false;
