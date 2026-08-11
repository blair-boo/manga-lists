-- Gerenciamento de listas (Settings > Genres/Tags): renomear e remover
-- valores do catálogo (generos/tags), propagando a mudança para as obras que
-- os usam. `obras.generos`/`obras.tags` são arrays soltos (sem FK pra
-- `listas`), então sem isso um valor editado/removido no catálogo ficaria
-- órfão nas obras que o referenciam. Cada função roda a atualização do
-- catálogo e das obras numa única transação (corpo da função).

create or replace function renomear_valor_lista(p_categoria text, p_valor_antigo text, p_valor_novo text)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_categoria not in ('genero', 'tag') then
    raise exception 'categoria inválida: %', p_categoria;
  end if;

  if p_categoria = 'genero' then
    update obras
    set generos = (
      select array(
        select distinct x from unnest(array_replace(generos, p_valor_antigo, p_valor_novo)) as x order by x
      )
    )
    where generos @> array[p_valor_antigo];
  else
    update obras
    set tags = (
      select array(
        select distinct x from unnest(array_replace(tags, p_valor_antigo, p_valor_novo)) as x order by x
      )
    )
    where tags @> array[p_valor_antigo];
  end if;

  -- Mescla: se já existe uma linha com o valor novo, a antiga só é descartada
  -- (as obras já foram unificadas no array_replace + distinct acima).
  if exists (select 1 from listas where categoria = p_categoria and valor = p_valor_novo) then
    delete from listas where categoria = p_categoria and valor = p_valor_antigo;
  else
    update listas set valor = p_valor_novo where categoria = p_categoria and valor = p_valor_antigo;
  end if;
end;
$$;

create or replace function remover_valor_lista(p_categoria text, p_valor text)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_categoria not in ('genero', 'tag') then
    raise exception 'categoria inválida: %', p_categoria;
  end if;

  if p_categoria = 'genero' then
    update obras set generos = array_remove(generos, p_valor) where generos @> array[p_valor];
  else
    update obras set tags = array_remove(tags, p_valor) where tags @> array[p_valor];
  end if;

  delete from listas where categoria = p_categoria and valor = p_valor;
end;
$$;

grant execute on function renomear_valor_lista(text, text, text) to authenticated;
grant execute on function remover_valor_lista(text, text) to authenticated;
