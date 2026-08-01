-- Renomeia obras.nota -> obras.score, pra não confundir com o novo campo de
-- notas/observações exportado no CSV como "notes" (Bloco CSV notes/sources).
-- Adiciona também o status de leitura 'Re-read'.

alter table obras rename column nota to score;
alter table obras rename constraint obras_nota_check to obras_score_check;

insert into listas (categoria, valor) values ('status_leitura', 'Re-read')
on conflict (categoria, valor) do nothing;
