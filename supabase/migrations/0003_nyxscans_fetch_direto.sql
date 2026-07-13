-- Roda no SQL Editor do Supabase (projeto já provisionado).
-- nyxscans passou a ter parser dedicado no scraper (requests simples, lê o
-- payload embutido do Next.js), então não precisa mais de 'busca_workaround'.
-- O scraper roteia por host de qualquer forma, mas mantemos a tabela coerente.

update sites_suportados set estrategia = 'fetch_direto' where nome = 'nyxscans';
