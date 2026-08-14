-- Bucket de capas (Supabase Storage)
--
-- Público para leitura (o service worker do PWA precisa cachear as imagens
-- offline sem autenticação), mas só usuários autenticados podem enviar/alterar.
-- Rode isto depois do schema.sql, no SQL Editor do Supabase.

insert into storage.buckets (id, name, public)
values ('capas', 'capas', true)
on conflict (id) do nothing;

create policy "capas_leitura_publica" on storage.objects
    for select using (bucket_id = 'capas');

create policy "capas_escrita_autenticada" on storage.objects
    for insert with check (bucket_id = 'capas' and auth.role() = 'authenticated');

create policy "capas_update_autenticada" on storage.objects
    for update using (bucket_id = 'capas' and auth.role() = 'authenticated');

create policy "capas_delete_autenticada" on storage.objects
    for delete using (bucket_id = 'capas' and auth.role() = 'authenticated');

-- Bucket de ícones (Supabase Storage)
--
-- Só leitura pública: sem essa policy de select, o bucket "public" ainda
-- baixa arquivos direto por URL (rota /object/public/ ignora RLS), mas
-- `.list()` continua vazio pro anon key porque passa pelas RLS de
-- storage.objects (aba Tests, D1).

insert into storage.buckets (id, name, public)
values ('icons', 'icons', true)
on conflict (id) do nothing;

create policy "icons_leitura_publica" on storage.objects
    for select using (bucket_id = 'icons');

-- Bucket de imagens importadas (Supabase Storage) — aba Images (Settings)
--
-- Mesmo padrão de "capas": leitura pública, escrita/update/delete só pra
-- usuária autenticada. "Pastas" são só prefixos de path (mesma convenção do
-- bucket "icons"), criadas via um objeto `.keep` dentro delas (Storage não
-- tem "criar pasta vazia" própria — ver src/lib/imagensSupabase.ts).

insert into storage.buckets (id, name, public)
values ('imagens-importadas', 'imagens-importadas', true)
on conflict (id) do nothing;

create policy "imagens_importadas_leitura_publica" on storage.objects
    for select using (bucket_id = 'imagens-importadas');

create policy "imagens_importadas_escrita_autenticada" on storage.objects
    for insert with check (bucket_id = 'imagens-importadas' and auth.role() = 'authenticated');

create policy "imagens_importadas_update_autenticada" on storage.objects
    for update using (bucket_id = 'imagens-importadas' and auth.role() = 'authenticated');

create policy "imagens_importadas_delete_autenticada" on storage.objects
    for delete using (bucket_id = 'imagens-importadas' and auth.role() = 'authenticated');

-- Bucket do Reader (Supabase Storage) — aba Reader
--
-- PRIVADO, ao contrário dos outros três: guarda o texto das novels baixadas,
-- que é obra protegida por direito autoral e não deve ficar acessível por URL
-- pública adivinhável. Consequência prática: o app lê daqui com
-- `createSignedUrl` (URL assinada, expira) em vez de `getPublicUrl` — funciona
-- num <a href> normal, só não é permanente.
--
-- Layout dos paths:
--   reader/<obra_id>/capa.jpg
--   reader/<obra_id>/md/<ordem>.md
--   reader/<obra_id>/out/<slug>.epub

insert into storage.buckets (id, name, public)
values ('reader', 'reader', false)
on conflict (id) do nothing;

create policy "reader_leitura_autenticada" on storage.objects
    for select using (bucket_id = 'reader' and auth.role() = 'authenticated');

create policy "reader_escrita_autenticada" on storage.objects
    for insert with check (bucket_id = 'reader' and auth.role() = 'authenticated');

create policy "reader_update_autenticada" on storage.objects
    for update using (bucket_id = 'reader' and auth.role() = 'authenticated');

create policy "reader_delete_autenticada" on storage.objects
    for delete using (bucket_id = 'reader' and auth.role() = 'authenticated');
