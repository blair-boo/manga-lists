# Checklist de teste — Edit mode da aba List

Roteiro de conferência manual do modo de edição (handouts `HANDOUT_MODO_EDICAO_1_SONNET.md` e
`HANDOUT_MODO_EDICAO_2_FABLE.md`). A UI está em inglês; os rótulos citados aqui são os que aparecem na tela.

## Botão e disponibilidade

- [ ] O rato aparece na ponta direita da linha das abas, em **todas** as abas.
- [ ] Fora da aba List o rato fica apagado e não responde a clique nem a toque.
- [ ] Na aba List em **Grid**, o rato também fica apagado.
- [ ] Na aba List em **List**, o rato acende e liga o modo.
- [ ] Com o modo ligado, o ícone vira o rato riscado (`Exit edit mode`).
- [ ] Navegar para outra aba e voltar para List: o modo volta **desligado**.
- [ ] Recarregar a página com o modo ligado: volta desligado (o estado não persiste, é de propósito).

## Botão flutuante

- [ ] Com o modo ligado, aparece um rato riscado flutuante no canto inferior direito.
- [ ] Ele tem fundo sólido e continua legível quando passa por cima de uma capa.
- [ ] Clicar nele sai do modo.
- [ ] Com um modal aberto, o flutuante fica **atrás** do véu escuro e não é clicável.

## Chips de lacuna

- [ ] `Unsourced`, `No cover`, `No NU link`, `No rating` e `No type` só aparecem com o modo ligado.
- [ ] Os chips de status de leitura, `New chapters` e `Novel` continuam sempre visíveis.
- [ ] Cada chip de lacuna cicla nos três estados (off → só estes → esconder estes → off).
- [ ] As contagens batem com o acervo.
- [ ] Nota 0 **não** aparece em `No rating`.
- [ ] Sair do modo zera os cinco chips: a lista volta completa e `Clear filters` some.

## Card — título e capa

- [ ] No modo, clicar no título abre o modal de título (não navega para a obra).
- [ ] Clique do meio / "abrir em nova aba" no título **não** abre a obra.
- [ ] O título aparece com sublinhado tracejado.
- [ ] Clicar na capa abre o seletor de arquivo.
- [ ] Durante o envio a capa fica opaca e o cursor vira de progresso.
- [ ] Trocar a capa de uma obra que já tinha uma: a imagem nova aparece sem recarregar a página.
- [ ] Falha de upload aparece como toast, não como texto dentro do card.

## Card — badges, estrelas e sources

- [ ] Com o modo ligado, a linha de badges mostra sempre: Age, Publication, EoS (só sob Hiatus), Type, Reading.
- [ ] Campo vazio aparece como chip tracejado com o nome do campo.
- [ ] Clicar em **Age** cicla nada → R-15 → R-18 → nada, sem abrir modal.
- [ ] **EoS** só aparece quando Publication é `Hiatus`, e alterna direto no clique.
- [ ] Trocar Publication para algo diferente de `Hiatus` some com o EoS.
- [ ] **Type**, **Reading** e **Publication** abrem o modal de seleção; escolher grava e fecha.
- [ ] As cinco estrelas aparecem sempre no modo (vazias como ☆).
- [ ] Clicar na estrela N grava a nota N.
- [ ] Clicar na estrela que já é a nota atual limpa a nota.
- [ ] As estrelas dão para acertar com o dedo (alvo de ~24px).
- [ ] `+ source` aparece abaixo das fontes (ou sozinho quando não há nenhuma).

## Modais

- [ ] Todos os modais fecham por X, por Esc e por clique fora da caixa.
- [ ] Clicar **dentro** da caixa não fecha.
- [ ] Tab e Shift+Tab circulam dentro do modal, incluindo o X.
- [ ] **Título:** editar o título e os alternative names grava os dois de uma vez.
- [ ] **Título:** digitar o nome de outra obra existente mostra aviso com link e bloqueia o Save.
- [ ] **Título:** editar o título sem mudar nada **não** acusa duplicata contra a própria obra.
- [ ] **Novel Updates:** URL que não é do novelupdates.com não grava e mostra aviso.
- [ ] **Novel Updates:** com link cadastrado aparece `Remove`, com confirmação.
- [ ] **Novel Updates:** o botão do NU sem link é clicável no modo (translúcido, mas não inerte).
- [ ] **Sources:** lista as fontes com o nome do site, `unmonitored` quando for o caso e o último capítulo.
- [ ] **Sources:** o `×` de cada linha pede confirmação antes de excluir.
- [ ] **Sources:** colar URL e clicar `+` (ou Enter) adiciona e limpa o campo, pronto para a próxima.
- [ ] **Sources:** URL vazia, inválida ou já cadastrada nessa obra é recusada com mensagem na própria caixa.

## Gravação

- [ ] Cada gravação mostra o toast `Saved ✓`.
- [ ] Erro em qualquer gravação mostra toast de erro legível (nunca `[object Object]`).
- [ ] Editar o título de uma obra com contraparte vinculada muda o título e os alternative names **nas duas**.
- [ ] Editar o título renomeia o arquivo da capa no bucket (a capa continua aparecendo).
- [ ] Editar com a rede desligada: a mudança aparece na hora e sobe sozinha no próximo sync.

## Layout

- [ ] A 390px de largura, o card no modo não estoura horizontalmente.
- [ ] Entrar e sair do modo não faz a página saltar de posição.
- [ ] Voltar da tela de uma obra ainda restaura a posição de scroll da lista.
