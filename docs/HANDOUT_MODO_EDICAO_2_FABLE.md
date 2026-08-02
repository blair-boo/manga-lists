# Handout 2 de 2 (Fable): Edit mode da aba List

Repositório: `blair-boo/manga-lists` (Ratsnest). Este handout depende do Handout 1 já aplicado (`ModalBase`, ícones do rato, `salvarCamposObra`, `useUploadCapa`, `adicionarFonteNaObra`, chips `No rating` e `No type`, cache dos ícones).

---

## Fase 0: revisão do Handout 1

Antes de escrever qualquer código novo, revisar o que a parte 1 entregou. Não confie na descrição, leia o código:

1. `ModalBase` é realmente o único lugar que monta `.modal-backdrop`? Os quatro modais migrados mantêm o comportamento anterior (foco, Esc, ações)?
2. `salvarCamposObra` reproduz fielmente a sequência de rename de capa que estava na `DetalheObraPage`, incluindo o caso de falha (segue gravando os outros campos)? O autosave da tela da obra continua sem re-gravar ao só carregar a obra?
3. `adicionarFonteNaObra` mantém `ordem` = maior + 1, `tipo_detectado` via `familiaDeTipo`, `status_aprovacao: 'aprovado'`, `descoberta_automaticamente: false` e a chamada a `registrarDominioManual`?
4. `useUploadCapa` preserva o bloqueio por título vazio e o cache buster da `uploadCapa`?
5. Os dois chips novos estão nos cinco lugares de `filtrosLista.ts` (interface, padrão, leitura, `temFiltroAtivo`, pipeline de filtro) e em `limparFiltros()`?

Corrija o que estiver divergente e **escreva um resumo curto no fim da execução**: o que estava certo, o que você ajustou e por quê.

---

## Contexto do módulo

O Edit mode transforma o card da lista em superfície editável, para preencher lacunas do acervo sem entrar em cada obra. Decisões já tomadas com a dona, que **não** são para reabrir:

- **Gravação imediata.** Cada confirmação de modal grava na hora, pelo caminho normal do app (Dexie + syncQueue). Sair do modo apenas sai do modo, não existe buffer de alterações pendentes. Não implemente "salvar ao sair".
- **Só na visualização List.** No Grid o modo fica bloqueado.
- **Autor, gêneros e tags ficam de fora** do modo, de propósito. Continuam só na tela da obra.
- **A UI do app é em inglês.** Rótulos: `Edit mode`, `Exit edit mode`.

---

## Bloco B1: contexto e disponibilidade

### B1.1. `src/components/ModoEdicaoContext.tsx`

```tsx
interface ModoEdicaoApi {
  /** Modo ligado. Só pode ser true quando disponivel é true. */
  modoEdicao: boolean;
  /** Alterna o modo. Ignorado quando indisponível. */
  alternarModo: () => void;
  /** Desliga o modo (usado ao sair da rota ou trocar pro grid). */
  sairDoModo: () => void;
  /** A tela atual suporta o modo (aba List na visualização List). */
  disponivel: boolean;
  /** Chamado pela ListaPrincipalPage pra declarar disponibilidade. */
  setDisponivel: (v: boolean) => void;
}
```

Regras dentro do provider:

- `alternarModo` não faz nada quando `disponivel` é false.
- Quando `disponivel` passa de true para false, `modoEdicao` vai para false automaticamente (via efeito). Isso cobre de uma vez os três casos: sair da aba List, desmontar a lista e trocar para o Grid.
- Estado **não** persiste em localStorage. Cada visita à lista começa com o modo desligado. Isso é deliberado: o modo muda o significado de cliques no card, e voltar a um app que reage diferente sem aviso é pior do que reativar com um clique.

O provider vai no `Layout.tsx`, envolvendo o conteúdo, ao lado do `DialogosProvider`.

### B1.2. Botão no canto direito da linha das abas

Em `Layout.tsx`, dentro de `.app-header-main`, o `<nav className="app-nav">` passa a dividir a linha com o botão. O botão fica na extremidade direita da linha das abas.

CSS em `src/styles/layout.css`:

```css
.app-header-main {
  /* era column; vira uma coluna com uma linha interna pro nav + botão */
}

.app-nav-linha {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
```

Envolver o `<nav>` e o botão numa `.app-nav-linha`, preservando o comportamento atual do `.app-nav` (inclusive o `flex-wrap: wrap`, que mantém as abas quebrando em telas estreitas sem empurrar o botão para fora).

O botão:

```tsx
<button
  type="button"
  className={`btn-icone modo-edicao-toggle${disponivel ? '' : ' btn-icone-sombra'}`}
  onClick={alternarModo}
  aria-pressed={modoEdicao}
  disabled={!disponivel}
  title={modoEdicao ? 'Exit edit mode' : 'Edit mode'}
  aria-label={modoEdicao ? 'Exit edit mode' : 'Edit mode'}
>
  {modoEdicao ? <IconeSairModoEdicao /> : <IconeModoEdicao />}
</button>
```

**O botão aparece em todas as abas**, para a linha das abas não mudar de altura nem de composição ao navegar. Fora da aba List, e dentro dela no Grid, ele fica "só a sombra": `.btn-icone-sombra` (opacidade 0.35, `pointer-events: none`) mais `disabled`. Os dois juntos são intencionais: o `disabled` cobre teclado e leitores de tela, o `pointer-events: none` cobre o toque.

---

## Bloco B2: `ListaPrincipalPage`

### B2.1. Declarar disponibilidade

```ts
const { modoEdicao, disponivel, setDisponivel, sairDoModo } = useModoEdicao();

useEffect(() => {
  setDisponivel(viewMode === 'list');
  return () => setDisponivel(false);
}, [viewMode, setDisponivel]);
```

O cleanup é o que desliga o modo ao navegar para outra aba. Confirme que `setDisponivel` é estável (`useCallback` no provider), senão o efeito entra em laço.

### B2.2. Chips exclusivos do modo

Os **cinco** chips de lacuna (`Unsourced`, `No cover`, `No NU link`, `No rating`, `No type`) passam a ser renderizados só quando `modoEdicao` é true. Os chips de status de leitura, `New chapter` e `Novel` continuam sempre visíveis.

**Ao sair do modo, os cinco voltam para `off`.** Sem isso a lista continua filtrada por uma condição invisível, sem chip na tela explicando o porquê. Implementar no mesmo efeito que observa `modoEdicao`: quando ele passa de true para false, zerar os cinco estados (o `useEffect` de persistência já grava a mudança no localStorage).

Entrar no modo **não** mexe nos filtros: eles já estarão em `off`, porque a única forma de ligá-los é dentro do modo.

Cuidado: não zerar os cinco na montagem inicial do componente, só na transição true → false. Use um `useRef` com o valor anterior, ou dispare a limpeza dentro do próprio `sairDoModo` exposto pela lista.

### B2.3. Posição do scroll

O `SCROLL_KEY` restaura a posição ao voltar da tela da obra. Entrar ou sair do modo **não** pode saltar o scroll. Como o modo troca a renderização dos cards, confira na prática: se houver salto, a causa provável é o card mudar de altura (ver B4.6).

---

## Bloco B3: botão flutuante de sair

Renderizado pela `ListaPrincipalPage` (não pelo Layout) apenas quando `modoEdicao` é true:

```tsx
<button type="button" className="btn-icone modo-edicao-flutuante" onClick={sairDoModo}
        title="Exit edit mode" aria-label="Exit edit mode">
  <IconeSairModoEdicao />
</button>
```

```css
.modo-edicao-flutuante {
  position: fixed;
  right: 16px;
  bottom: calc(16px + env(safe-area-inset-bottom));
  z-index: 90;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 8px;
  box-shadow: var(--shadow-hover);
}
```

Notas:

- `z-index: 90` fica abaixo do `.modal-backdrop` (100) e dos toasts (200). Com um modal aberto, o flutuante fica atrás do véu escuro, que é o comportamento certo: não dá para sair do modo no meio de uma edição sem antes fechar o modal.
- Fundo sólido `var(--bg)` e borda são necessários: sem eles, o rato fica ilegível quando passa por cima de uma capa.
- O `env(safe-area-inset-bottom)` cobre o iOS em standalone.

---

## Bloco B4: o card em modo de edição

`ObraCard` recebe `modoEdicao?: boolean`. O card normal é renderizado centenas de vezes; não engorde o caminho comum. Estruture assim:

- `ObraCard` continua sendo o componente de layout. Onde há divergência, ele escolhe entre o subcomponente normal e o de edição.
- Os subcomponentes de edição e os modais vão para um arquivo novo, `src/components/ObraCardEdicao.tsx`, para o `ObraCard.tsx` não virar um arquivo de 600 linhas.

**O layout do card não muda entre os modos.** Mesmos blocos, mesma ordem, mesmas dimensões. O que muda é o que cada elemento faz ao ser clicado e a presença dos placeholders.

### B4.1. Título

Fora do modo: `<Link to={/obra/:id} className="obra-card-titulo">`, como hoje.

No modo: `<button type="button" className="obra-card-titulo obra-card-titulo-editavel">` que abre o modal de título.

Use um elemento diferente, **não** um `Link` com `preventDefault`. Um `<a>` continua abrindo por clique do meio, long press no iOS e "abrir em nova aba", o que quebraria a promessa de que o título não navega no modo.

### B4.2. Capa

No modo, a `.obra-card-capa` vira clicável (`role="button"`, `aria-label="Change cover"`) e chama `abrirSeletor` do `useUploadCapa`, com `onUploaded` gravando via `salvarCamposObra(obra, { capa_url: url })`.

Durante o envio, aplicar a classe `.enviando` que já existe (opacidade 0.5, `cursor: progress`). Erro de upload vira toast, não texto dentro do card (não há espaço).

O `uploadCapa` já usa slug determinístico e cache buster, então trocar a capa de uma obra que já tem uma sobrescreve o arquivo e a imagem atualiza sozinha.

### B4.3. Novel Updates

`NovelUpdatesBotao` ganha o modo:

- Com link cadastrado: no modo, vira `<button>` que abre o modal do NU (em vez do `<a>` que abre o site).
- Sem link: hoje é um `<span>` com `.obra-card-nu-botao-vazio` (`pointer-events: none`). No modo, vira `<button>` clicável que abre o mesmo modal, com opacidade 0.55 em vez de 0.35, para não parecer inerte.

### B4.4. Badges e placeholders

A `.obra-card-meta` no modo mostra, sempre, uma posição para cada campo editável, na ordem: **Age** (classificação), **Publication**, **EoS**, **Type**, **Reading**.

- Campo preenchido: o badge de hoje, agora clicável, abrindo o seletor correspondente.
- Campo vazio: um chip com contorno tracejado e fundo acinzentado, com o rótulo curto do campo (`Reading`, `Type`, `Publication`, `Age`), abrindo o mesmo seletor.

```css
.chip-vazio {
  font-size: 11px;
  background: none;
  border: 1px dashed var(--border);
  border-radius: 4px;
  padding: 1px 6px;
  color: var(--text);
  opacity: 0.55;
  cursor: pointer;
}

.chip-vazio:hover {
  opacity: 0.85;
}
```

Opacidade 0.55, não 0.35: o 0.35 do `.obra-card-nu-botao-vazio` é para um indicador inerte; aqui é alvo de toque.

Regras de comportamento:

- **Age** (`classificacao`): clique cicla `null` → `R-15` → `R-18` → `null`, sem modal. São três valores, um modal seria mais caro que o ganho.
- **EoS** (`fim_de_temporada`): só aparece, preenchido ou como placeholder, quando `status_publicacao === 'Hiatus'`. Fora do Hiatus o campo é inválido, e a `CadastrarPage` já força `false` nesse caso. Clique alterna direto, sem modal.
- **Type**, **Reading**, **Publication**: abrem o modal de seleção (B5.3). Mudar `status_publicacao` para algo diferente de `Hiatus` grava também `fim_de_temporada: false` no mesmo patch.

### B4.5. Estrelas

`Estrelas` hoje devolve `null` quando não há nota. No modo, renderiza sempre cinco estrelas: as preenchidas até a nota e as "sombras" (☆) no restante, todas clicáveis.

- Clicar na estrela N grava `nota: N`.
- Clicar na estrela que já é a nota atual limpa (`nota: null`). É a única saída para desfazer, então não pode faltar.
- Alvo de toque de pelo menos 24px por estrela. Ampliar com `padding` no botão de cada estrela, sem aumentar o glifo, para o card não mudar de altura.
- `role="radiogroup"` no conjunto e `aria-label` por estrela (`Rate 3 of 5`).

Gravação imediata, sem modal. A frase original da dona, "clicando nas estrelas abre para alterar o score", está atendida: o próprio conjunto de estrelas é o controle.

### B4.6. Sources

Abaixo da lista de fontes (ou no lugar dela quando não há nenhuma), um botão `+ source` com o mesmo estilo tracejado do `.chip-vazio`, abrindo o modal de sources (B5.4).

**Cuidado com a altura do card no Grid.** O modo não roda no Grid, então o risco é só o da visualização List, onde o card é largo. Ainda assim, confira a 390px: com os cinco placeholders na `.obra-card-meta` mais o `+ source`, o card cresce. `flex-wrap: wrap` já está na `.obra-card-meta`, então deve acomodar; o que não pode acontecer é estouro horizontal.

---

## Bloco B5: modais de edição

Todos sobre `ModalBase`, todos com X, Esc e clique no backdrop. Todos gravam via `salvarCamposObra`, que cuida do rename de capa e do espelhamento manga/novel.

### B5.1. Título e alternative names

- Input do título, pré-preenchido.
- Alternative titles com o `TagPicker` usando `options={[]}`, exatamente como a tela da obra faz para esse campo.
- **Checagem de duplicata**, reaproveitando `encontrarObraDuplicada()` de `repo.ts` com debounce, como na aba Add: aviso não bloqueante com link para a possível duplicata, bloqueio apenas em casamento exato.
  - **Ponto crítico:** aqui a obra sendo editada já existe no banco. A checagem precisa ignorar a própria obra (`id !== obra.id`), senão toda edição de título acusa duplicata contra ela mesma. Se `encontrarObraDuplicada` ainda não aceita um id a excluir, adicione o parâmetro opcional e mantenha o comportamento atual quando ele não for passado.
- Ações: `Save` e `Cancel`, mais o X.
- Salvar grava `titulo` e `titulos_alternativos` num patch só. O espelhamento para a obra vinculada e o rename da capa saem de graça pelo `salvarCamposObra`.

### B5.2. Novel Updates

- Input com a URL atual, quando houver.
- Mesma validação da tela da obra: se não casar com `/novelupdates\.com/i`, toast informativo e não grava.
- Quando já existe link, oferecer também `Remove`, com confirmação (`useDialogos().confirmar`), gravando `novelupdates_url: null`.
- `novelupdates_url` está em `CAMPOS_ESPELHADOS`, então a contraparte vinculada recebe o mesmo valor automaticamente. Não replique isso na mão.

### B5.3. Type, Reading status, Publication status

Um único componente de seleção parametrizado, alimentado por `useListasPorCategoria('tipo' | 'status_leitura' | 'status_publicacao')`. Lista de opções como botões (não um `<select>`: no modal, com poucas opções, o toque direto é melhor no celular), mais uma opção `None` que grava `null`.

Selecionar grava e fecha o modal, sem botão de confirmar. É um clique só, e o X continua disponível para desistir antes de escolher.

### B5.4. Sources

Conteúdo do modal:

1. Lista das fontes cadastradas da obra, mostrando o nome do site (`fonte.site || dominioDeUrl(fonte.url)`), o badge `unmonitored` quando o domínio não está aprovado e o último capítulo detectado, tudo em leitura.
2. Um `×` por linha para excluir a fonte, com confirmação via `useDialogos().confirmar`. Reaproveite a função de exclusão já usada pelo `FonteItem` da tela da obra; não escreva outra.
3. Campo de colar URL com um botão `+` ao lado. `+` (ou `Enter`) chama `adicionarFonteNaObra` e limpa o campo, deixando-o pronto para a próxima. Não empilhe campos vazios: um campo que se esvazia atende ao pedido de "abre um novo espaço para a próxima" sem crescer o modal indefinidamente.
4. Recusar URL vazia, URL inválida e URL já cadastrada **nessa obra** (comparação normalizada, sem barra final). Nos dois últimos casos, mensagem inline curta, não toast.

A lista de fontes vem por `useLiveQuery`, então cada adição aparece sozinha.

### B5.5. Toasts

Cada gravação bem sucedida dispara um toast curto (`Saved ✓`). É o que substitui a sensação de "salvar ao sair". Toast de erro em qualquer falha, com `mensagemDeErro`.

---

## Bloco B6: sinal visual do modo

O rato flutuante já é o lembrete constante, mas o card precisa comunicar que os cliques mudaram de significado. Use o mínimo que resolve:

```css
/* Título editável: perde a cara de link e ganha o sublinhado tracejado que o
   app já usa pra edição inline (.cap-atual-botao). */
.obra-card-titulo-editavel {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  text-align: left;
  color: var(--accent);
  border-bottom: 1px dashed var(--accent-border);
  cursor: pointer;
}
```

Não adicione tarja, banner nem borda colorida no card. A lista inteira mudando de cor a cada entrada no modo cansa rápido, e os placeholders tracejados já são um sinal forte.

---

## Bloco B7: verificação

Além do checklist entregue à dona em `CHECKLIST_TESTE_MODO_EDICAO.md`, raciocine explicitamente sobre estes cenários e confirme que a implementação os cobre:

1. Ligar o modo, filtrar por `No cover`, subir uma capa numa obra: a obra some da lista filtrada no mesmo instante (o `useLiveQuery` a remove). O card seguinte não deve receber o clique seguinte por acidente de layout.
2. Ligar o modo, filtrar por `No rating`, sair do modo pelo botão flutuante: a lista volta completa e nenhum chip fica ativo escondido.
3. Ligar o modo e trocar para o Grid pelo `view-toggle`: o modo desliga, os filtros de lacuna zeram e o botão do header vira sombra.
4. Ligar o modo, abrir o modal de título, clicar no rato flutuante: o flutuante está atrás do backdrop e não é alcançável. Fechar o modal primeiro e então sair funciona.
5. Editar o título de uma obra que tem contraparte vinculada: o título e os títulos alternativos mudam nas duas, e a capa é renomeada no bucket.
6. Editar offline: a alteração aparece na hora (Dexie) e entra na syncQueue, subindo no próximo sync.
7. Obra com `novelupdates_url` `undefined` (registro local antigo): o botão vazio do NU é clicável no modo e grava normalmente.

Incluir os dois handouts no repo, em `docs/`.
