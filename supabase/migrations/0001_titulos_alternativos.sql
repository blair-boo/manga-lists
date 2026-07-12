-- Roda no SQL Editor do Supabase (projeto já provisionado).
-- Adiciona suporte a múltiplos títulos alternativos por obra.

alter table obras add column if not exists titulos_alternativos text[];
