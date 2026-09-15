-- Backfill do catálogo (listas): alguns valores em obras.generos/obras.tags
-- nunca foram inseridos em `listas` (import inicial via scripts/import-data.mjs
-- só semeou listas_seed.csv uma vez; scripts/update-from-csv.mjs e o próprio
-- app, antes desta correção, escreviam generos/tags direto na obra sem
-- espelhar em listas). Aditivo e idempotente: nunca remove nada, só insere o
-- que falta, via o mesmo unique(categoria, valor) usado por adicionarValorLista.
insert into listas (categoria, valor)
select 'genero', valor
from (select distinct unnest(generos) as valor from obras where generos is not null) g
where valor is not null and btrim(valor) <> ''
on conflict (categoria, valor) do nothing;

insert into listas (categoria, valor)
select 'tag', valor
from (select distinct unnest(tags) as valor from obras where tags is not null) t
where valor is not null and btrim(valor) <> ''
on conflict (categoria, valor) do nothing;
