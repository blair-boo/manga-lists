-- Roda no SQL Editor do Supabase (projeto já provisionado).
--
-- Corrige "column sites_suportados.criado_em does not exist" na aba Updates:
-- a fila de domínios pendentes (AprovacaoDominios) mostra "requested {data}" e
-- consulta `criado_em`, mas a tabela nunca teve essa coluna (todas as outras
-- tabelas já seguem o padrão `criado_em timestamptz not null default now()`).
--
-- `default now()` preenche automaticamente os inserts existentes (cadastro
-- manual de domínio, descoberta de fontes) sem precisar tocar no código de
-- inserção; as linhas já existentes recebem o timestamp da migração.

alter table sites_suportados
  add column if not exists criado_em timestamptz not null default now();
