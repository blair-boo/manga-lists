-- Status de leitura 'Complete' vira 'Finished' (colidia visualmente com o
-- status de PUBLICAÇÃO 'Completed', que permanece inalterado).

update listas
   set valor = 'Finished'
 where categoria = 'status_leitura'
   and valor = 'Complete';

-- `atualizado_em` já é tocado pelo trigger trg_obras_atualizado_em (before
-- update on obras), então não precisa ser setado aqui explicitamente.
update obras
   set status_leitura = 'Finished'
 where status_leitura = 'Complete';
