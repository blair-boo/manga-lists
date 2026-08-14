-- Roda no SQL Editor do Supabase (ou via apply_migration).
--
-- Corrige a identidade de reader_capitulos.
--
-- A 0021 usou `unique (reader_obra_id, url)`, copiando a regra de `fontes`. A
-- investigação dos sites (2026-08) mostrou que isso não se sustenta: nos temas
-- Madara — que cobrem 3 dos 6 sites usados — um capítulo atrás de paywall vem
-- com `href="#"`, ou seja, NÃO TEM URL, e só ganha uma quando o paywall cai.
--
-- Com a chave antiga isso dá errado de dois jeitos:
--   - vários bloqueados da mesma obra colidem no mesmo '#' (a segunda inserção
--     falha); e se a URL for NULL é pior, porque em Postgres NULL != NULL para
--     efeito de unique, então cada varredura DUPLICA todos os bloqueados;
--   - quando o paywall cai e o capítulo ganha URL, ele vira linha nova e a
--     antiga fica órfã — perdendo o histórico de estado do capítulo.
--
-- A identidade passa a ser `chave`: o número do capítulo normalizado a partir
-- do rótulo do site ("Chapter 143.2" -> '143.2', "Side Story 3" -> 'ss-3').
-- É o único dado estável entre o estado bloqueado e o liberado. A URL vira
-- atributo mutável, que é o que ela sempre foi de fato.
--
-- `id_externo` guarda o id do capítulo no site quando ele existir (no Madara,
-- o `data-chapter-14124` da classe do <li>). NÃO é chave — só os bloqueados o
-- expõem —, mas ajuda a casar e a depurar.
--
-- Sem backfill: as tabelas do Reader ainda estão vazias.

alter table reader_capitulos
  add column if not exists chave text;

alter table reader_capitulos
  add column if not exists id_externo text;

-- Defensivo: se houver linha antiga sem chave (não deve haver), deriva do que
-- der, pra que o `not null` abaixo não falhe.
update reader_capitulos
set chave = coalesce(
  chave,
  nullif(numero_texto, ''),
  case when side_story then 'ss-' else '' end || numero::text,
  id::text
)
where chave is null;

alter table reader_capitulos
  alter column chave set not null;

alter table reader_capitulos
  drop constraint if exists reader_capitulos_reader_obra_id_url_key;

-- É esta constraint que torna a varredura idempotente: revarrer atualiza a
-- linha existente (upsert por (reader_obra_id, chave)) em vez de duplicar.
alter table reader_capitulos
  drop constraint if exists reader_capitulos_reader_obra_id_chave_key;

alter table reader_capitulos
  add constraint reader_capitulos_reader_obra_id_chave_key unique (reader_obra_id, chave);

-- A varredura do Reader grava em scraper_runs como qualquer outro estágio, e o
-- CHECK atual não conhece 'reader' — sem isto, iniciar_run() falha na inserção.
alter table scraper_runs drop constraint if exists scraper_runs_tipo_check;
alter table scraper_runs
  add constraint scraper_runs_tipo_check
  check (tipo in ('capitulos', 'obras', 'fontes', 'designar', 'novelupdates', 'reader'));
