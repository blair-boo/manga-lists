-- Roda no SQL Editor do Supabase (projeto já provisionado).
--
-- Handout "Espelhamento de obras vinculadas / UI de obra" — Bloco A:
--   - obras.classificacao: classificação indicativa (nenhuma / R-15 / R-18).
--     Campo único (não dois booleanos) pra evitar estado inválido — uma obra
--     não é R-15 e R-18 ao mesmo tempo.
--   - fontes.ordem: ordem manual das fontes dentro de uma obra (menor aparece
--     primeiro; fontes legadas ficam null e caem por último, desempate por
--     criado_em).

alter table obras
  add column if not exists classificacao text check (classificacao in ('R-15', 'R-18'));

alter table fontes
  add column if not exists ordem integer;
