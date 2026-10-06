-- Resumo do último backup para o R2 (aba Settings > Backup). O workflow
-- .github/workflows/backup.yml grava esta linha única com a chave de serviço
-- (que ignora RLS); o app só lê. O navegador não consegue consultar o R2
-- direto (exigiria expor as chaves), por isso o resumo passa pelo Supabase.

create table if not exists backup_status (
    id integer primary key default 1 check (id = 1), -- linha única
    atualizado_em timestamptz not null default now(),
    -- [{ "tipo": "weekly"|"monthly", "nome": "2026-10-04", "tamanho_bytes": 123, "linhas": 4567 }]
    snapshots jsonb not null default '[]'::jsonb,
    tamanho_total_bytes bigint not null default 0,
    tamanho_db_bytes bigint not null default 0,
    tamanho_imagens_bytes bigint not null default 0,
    objetos_imagens integer not null default 0
);

alter table backup_status enable row level security;

-- Só leitura para a usuária autenticada; escrita só pela chave de serviço.
create policy "authenticated_read_backup_status" on backup_status
    for select using (auth.role() = 'authenticated');
