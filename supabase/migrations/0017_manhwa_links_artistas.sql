-- Rodar manualmente no SQL Editor do Supabase.
--
-- 1) Correção de grafia: Manwha -> Manhwa.
-- Se houver um check constraint em obras.tipo, ele precisa ser derrubado
-- ANTES do update e recriado depois. Conferir com:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'obras'::regclass;
-- Se existir (nome provável: obras_tipo_check), rodar:
--   alter table obras drop constraint obras_tipo_check;

update obras set tipo = 'Manhwa' where tipo = 'Manwha';
update listas set valor = 'Manhwa' where categoria = 'tipo' and valor = 'Manwha';

-- Recriar o constraint só se ele existia antes, com a grafia corrigida:
--   alter table obras add constraint obras_tipo_check
--     check (tipo in ('Manga', 'Manhwa', 'Manhua', 'Novel'));

-- 2) Campo de artistas (separado de autor).
alter table obras add column if not exists artistas text;

-- 3) Links externos, no mesmo modelo de novelupdates_url.
alter table obras add column if not exists anilist_url text;
alter table obras add column if not exists myanimelist_url text;
alter table obras add column if not exists mangaupdates_url text;
alter table obras add column if not exists mangadex_url text;
alter table obras add column if not exists mangabaka_url text;
