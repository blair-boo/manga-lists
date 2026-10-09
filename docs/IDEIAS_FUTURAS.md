# Ideias combinadas para depois

Sugestões já aprovadas pela usuária, mas deixadas para uma próxima rodada. Antes
de começar qualquer uma, planejar e confirmar o escopo. Ao fazer uma, apagar a
entrada daqui.

## 1. Ícones e abas configuráveis (inspirado no personal-organizer)

Hoje o nome do arquivo de cada ícone fica fixo no código (`IconeMascarado` com um
nome de arquivo do bucket `icons`), então trocar um ícone exige mudar código. No
personal-organizer existe um sistema configurável:

- `icones_usos`: tabela que liga cada função (salvar, editar, excluir...), título
  ou aba a um arquivo do bucket, com tamanho, máscara de cor e tema.
- `IconeFuncao` / `IconeUso`: componentes que leem esse vínculo, com um padrão
  quando não há linha própria.
- `abas_config` e `NavAbas`: nome, ícone e ordem das abas editáveis por um modo
  de edição.
- Tela Settings > Ícones para escolher o ícone de cada função sem mexer em código.

Esforço médio-alto. Faz sentido porque o manga-lists já usa ícones do bucket por
nome de arquivo. Referência: `src/components/IconeUso.tsx`, `src/lib/iconesUsos.ts`,
`src/lib/iconesFuncoes.ts`, `src/components/NavAbas.tsx` e a migration
`0015_icones_usos.sql` do repositório `blair-boo/personal-organizer`.

## 2. Gráficos de estatísticas de leitura (inspirado no Resumo Geral do personal-organizer)

Tela de estatísticas com gráficos (o personal-organizer usa `recharts`): obras
por status de leitura, por tipo, nota média e quantas obras foram lidas por mês.
Mais um extra do que uma necessidade. Esforço médio.
