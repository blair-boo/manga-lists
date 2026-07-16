-- Roda no SQL Editor do Supabase (projeto já provisionado).
--
-- Handout consolidado, Bloco B — lógica manga vs novel:
--   - obras.obra_vinculada_id: vínculo entre o manga e a novel da mesma
--     história (mútuo — B3). Title/Alternative Title são espelhados entre
--     as duas obras vinculadas quando um dos dois muda (feito na aplicação,
--     não em trigger, pra manter a lógica visível em repo.ts).
--   - fontes.tipo_detectado: 'manga' | 'novel' detectado pela hierarquia de
--     sinais (URL > título da página > og:type) ao ler a fonte (B1).
--   - fontes.tipo_manual: quando true, a decisão de tipo (e a obra a que a
--     fonte pertence) foi definida manualmente pela usuária — o scraper de
--     auto-descoberta/atualização nunca sobrescreve nem reatribui essa fonte
--     de volta (B4, "garantia crítica").

alter table obras
  add column if not exists obra_vinculada_id uuid references obras(id) on delete set null;

alter table fontes
  add column if not exists tipo_detectado text check (tipo_detectado in ('manga', 'novel'));

alter table fontes
  add column if not exists tipo_manual boolean not null default false;
