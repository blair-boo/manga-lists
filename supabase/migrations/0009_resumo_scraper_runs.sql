-- Roda no SQL Editor do Supabase (projeto já provisionado).
--
-- Handout 1 (Sonnet), item C3: resumo estruturado das runs do scraper.
-- Contadores (encontradas/atualizadas/falhas etc.) preenchidos pelos três
-- estágios (update_fontes.py, update_obras.py, discover_fontes.py) via
-- finalizar_run, pra a UI de Updates mostrar sem parsear a string de mensagem.

alter table scraper_runs add column if not exists resumo jsonb;
