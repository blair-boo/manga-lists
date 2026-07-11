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
