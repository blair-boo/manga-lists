-- Rodar manualmente no SQL Editor do Supabase.
--
-- Nostalgic: marcação independente por obra para os mangás antigos que a
-- usuária leu e amou (separado de Favoritos, que ficam para os mais atuais).
-- Mesmo modelo de favorito/pdf: não espelhada entre obras vinculadas manga<->novel.
alter table obras add column if not exists nostalgic boolean not null default false;
