-- Rejeita swarm.ws e inkster.pkjob.pk (blacklist + sai da fila de pendentes) e
-- remove o Google de sites_suportados: é onde se pesquisa, não uma source.
-- O Google NÃO vai pra blacklist (e sai dela, se já estiver lá), pra não
-- atrapalhar o "Find new sources".

insert into dominios_bloqueados (dominio, motivo)
values
    ('swarm.ws', 'Rejected from domain approval queue'),
    ('inkster.pkjob.pk', 'Rejected from domain approval queue')
on conflict (dominio) do nothing;

delete from sites_suportados
where ativo = false
  and nome in ('swarm.ws', 'inkster.pkjob.pk');

delete from sites_suportados
where nome in ('google.com', 'www.google.com', 'google');

delete from dominios_bloqueados
where dominio in ('google.com', 'www.google.com', 'google');
