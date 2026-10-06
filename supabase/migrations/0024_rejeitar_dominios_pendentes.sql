-- Rejeita swarm.ws e inkster.pkjob.pk (blacklist + sai da fila de pendentes) e
-- remove o Google de sites_suportados: é onde se pesquisa, não uma source.

insert into dominios_bloqueados (dominio, motivo)
values
    ('swarm.ws', 'Rejected from domain approval queue'),
    ('inkster.pkjob.pk', 'Rejected from domain approval queue')
on conflict (dominio) do nothing;

delete from sites_suportados
where ativo = false
  and nome in ('swarm.ws', 'inkster.pkjob.pk');

delete from sites_suportados
where nome ilike 'google%'
   or url_base ilike '%google.%';
