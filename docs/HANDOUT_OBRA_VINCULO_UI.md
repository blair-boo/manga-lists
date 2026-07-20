# Handout: Espelhamento de obras vinculadas, reorganização da página de obra, classificação R-15/R-18, autosave e reordenação de fontes

Repositório: `blair-boo/manga-lists` (PWA Ratsnest: Vite + React + TS, Dexie, Supabase, GitHub Pages). Ambiente principal de uso: iOS Safari / PWA standalone — priorizar toque confiável.

Executar na ordem dos blocos (A a G). Alguns blocos dependem de migração de schema feita antes (Bloco A). Cada item aponta os arquivos reais já existentes. Se algo não puder ser concluído, registrar o motivo e seguir para o próximo em vez de travar.

Convenções do projeto a respeitar:
- Persistência local-first: alterações passam por `updateObra`/`updateFonte`/`createFonte` em `src/db/repo.ts`, que já enfileiram mutação e disparam sync. NÃO escrever direto no Dexie a partir de componentes.
- Estilos ficam em `src/index.css` (arquivo único). Reutilizar tokens (`--accent`, `--danger`, `--warn`, `--border`, `--bg-raised`, etc.) e classes existentes (`.upload-capa-botao`, `.capa-preview`, `.badge`, `.detalhe-obra-grid`, `.check-inline`).
- Erros de UI: usar mensagem legível (se o helper `mensagemDeErro` já existir de handout anterior, usá-lo; senão, exibir `err.message`).

---

## Bloco A: Schema e tipos (fazer primeiro)

Duas colunas novas. Criar um arquivo de migração em `supabase/migrations/` seguindo o padrão dos existentes (ex.: `0009_classificacao_ordem_fontes.sql`), para rodar manualmente no SQL Editor:

```sql
-- Classificação indicativa da obra (nenhuma / R-15 / R-18).
alter table obras
  add column if not exists classificacao text check (classificacao in ('R-15', 'R-18'));

-- Ordem manual das fontes dentro de uma obra (menor aparece primeiro).
alter table fontes
  add column if not exists ordem integer;
```

Em `src/types/index.ts`:
- Adicionar `classificacao: 'R-15' | 'R-18' | null;` na interface `Obra` (criar um alias `export type Classificacao = 'R-15' | 'R-18';` e usar `Classificacao | null`).
- Adicionar `ordem: number | null;` na interface `Fonte`.

Verificar todos os pontos que constroem uma `Obra`/`NovaObra` ou `Fonte`/`NovaFonte` literal e adicionar os campos novos com default nulo, para o TypeScript não quebrar:
- `src/db/repo.ts`: `createFonte` (o handler que monta a fonte), `criarObraVinculada`, qualquer `NovaObra` montada.
- `src/pages/CadastrarPage.tsx`: objeto `obra: NovaObra` no `handleSubmit`; a fonte não é montada aqui (vai por `criarObraComFontes`), conferir essa função.
- `src/pages/DetalheObraPage.tsx`: `handleAdicionarFonte` (monta `NovaFonte` — incluir `ordem: null` ou já calcular, ver Bloco F), `handleCriarVinculada` (monta `NovaObra` — incluir `classificacao: null`).
- Qualquer seed/import script que monte esses objetos (`scripts/`), se aplicável ao build do frontend (provavelmente não, mas conferir se o tipo é compartilhado).

Sync: `pullObras`/`pullFontes` fazem `bulkPut` do que vem do Supabase, então os campos novos fluem sozinhos assim que existirem nas duas pontas. Não precisa mexer no mapeamento salvo se houver conversão explícita coluna->campo (conferir `src/sync/sync.ts`; se o mapeamento for explícito, adicionar `classificacao` e `ordem`).

---

## Bloco B: Espelhamento total entre obras vinculadas

Hoje `updateObra` em `src/db/repo.ts` espelha apenas `titulo` e `titulos_alternativos` para a obra vinculada, via `espelharTitulo`. A dona quer espelhar TAMBÉM `generos` e `tags`, tanto na edição contínua quanto na criação da obra correspondente.

### B1. Espelhamento contínuo (edição)

Generalizar `espelharTitulo` para `espelharCampos` (renomear), cobrindo os quatro campos espelhados: `titulo`, `titulos_alternativos`, `generos`, `tags`.

```ts
const CAMPOS_ESPELHADOS = ['titulo', 'titulos_alternativos', 'generos', 'tags'] as const;

/** Replica os campos espelhados na obra vinculada, sem reentrar no espelhamento (evita recursão). */
async function espelharCampos(obraId: string, changes: Partial<NovaObra>): Promise<void> {
  const patch: Partial<NovaObra> = {};
  for (const campo of CAMPOS_ESPELHADOS) {
    if (campo in changes) (patch as Record<string, unknown>)[campo] = changes[campo];
  }
  if (Object.keys(patch).length === 0) return;

  const now = new Date().toISOString();
  await db.obras.update(obraId, { ...patch, atualizado_em: now });
  const full = await db.obras.get(obraId);
  if (!full) return;
  await enqueueMutation({ entity: 'obras', op: 'update', recordId: obraId, payload: full });
  triggerBackgroundSync();
}
```

No `updateObra`, trocar a condição atual (`'titulo' in changes || 'titulos_alternativos' in changes`) por: se `full.obra_vinculada_id` existir e algum dos `CAMPOS_ESPELHADOS` estiver em `changes`, chamar `espelharCampos(full.obra_vinculada_id, changes)`.

Cuidado com recursão: `espelharCampos` grava direto no Dexie + enqueue (não passa por `updateObra`), então não re-dispara o espelhamento. Manter esse desenho.

### B2. Espelhamento na criação da obra correspondente

`criarObraVinculada` recebe os dados da nova obra já prontos do `DetalheObraPage`. Hoje o `handleCriarVinculada` passa `generos: null, tags: null` e só o título. Alterar `handleCriarVinculada` em `DetalheObraPage.tsx` para copiar da obra de origem: `titulos_alternativos`, `generos`, `tags` (além do `titulo` que já pede). Assim a nova obra nasce com os quatro campos espelhados preenchidos, e daí em diante o espelhamento contínuo (B1) mantém sincronizado.

O mesmo vale para o vínculo no cadastro (`CadastrarPage`, quando `temVinculo && obraVinculadaId`): ao vincular duas obras já existentes, NÃO sobrescrever os campos de nenhuma das duas na hora do vínculo (as duas já existem com seus dados); o espelhamento passa a valer da próxima edição em diante. Ou seja: `vincularObras` continua só setando o `obra_vinculada_id` mútuo, sem copiar campos. Só a CRIAÇÃO inline (`criarObraVinculada`) copia o estado inicial.

### B3. Confirmar bidirecionalidade do vínculo

Verificar que ao vincular (`vincularObras`) e ao criar inline (`criarObraVinculada` -> `vincularObras`), o `obra_vinculada_id` é setado nas DUAS obras (já é: `vincularObras` faz `updateObra` em A e B). Nenhuma mudança esperada aqui além de confirmar; a dona reforçou que linkar A→B tem que deixar B→A, tanto para obra criada na hora quanto para obra já existente.

---

## Bloco C: Reorganização da página de obra (DetalheObraPage)

Ordem nova das seções no `.detalhe-obra-form`, de cima para baixo:

1. Title
2. Alternative title
3. Author
4. **Bloco de capa** (novo layout, ver C1) — movido para cá, ACIMA das notas
5. `detalhe-obra-grid` (Type, Reading status, Current chapter, Publication status, End of Season, Rating) + **R-15/R-18** ao lado do Rating (Bloco D)
6. Vínculo (Corresponding work) — mantém
7. Genres
8. Tags
9. **Notes** com autosave próprio e botões Save/Cancel condicionais (Bloco E)
10. (resto dos campos, se houver)
11. **Delete work** — mover para o FINAL da página, depois da seção de Sources (ver nota abaixo)

Nota sobre o Delete work: hoje ele fica dentro do `.detalhe-obra-form`, logo após os botões Save/Cancel. Mover para o final absoluto da página, depois da `<section className="fontes-section">`. Envolver num container próprio (ex.: `.detalhe-obra-rodape`) com um espaçamento maior acima, para ficar claramente separado e evitar clique acidental. Manter a classe `.excluir-obra` e o fluxo de confirmação atual.

### C1. Novo layout do bloco de capa

Hoje a capa é: label "Cover (URL)" com input sempre visível + `<CapaUploader>` + `<img className="capa-preview">` empilhados verticalmente.

Novo desenho, espelhando o formato da lista principal (miniatura à esquerda, controles à direita):

- Container `.capa-bloco` com `display: flex; gap: 12px; align-items: flex-start;`.
- À esquerda: a miniatura `.capa-preview` (já existe, 100px, aspect 2/3), exibida só quando há `capa_url`. Quando não há capa, mostrar um placeholder do mesmo tamanho (`.capa-preview-vazia`, com borda tracejada e um ícone/traço neutro) para o layout não pular.
- À direita, empilhados (`display: flex; flex-direction: column; gap: 8px;`):
  - O botão de upload (`<CapaUploader>`, que já renderiza `.upload-capa-botao` com o texto "Upload image").
  - Um botão novo "Cover URL" (`.upload-capa-botao` para casar o estilo) que, ao ser clicado, ALTERNA a exibição de um input de texto da URL. O input começa OCULTO. Estado local `const [mostrarUrl, setMostrarUrl] = useState(false)`. Ao abrir, o input aparece logo abaixo dos botões (dentro da coluna direita), já focado, com o valor de `draft.capa_url`. Digitar continua chamando `setCampo('capa_url', ...)` (autosave do Bloco E cuida de salvar).
  - Se já houver `capa_url` preenchida, o botão pode rotular "Edit URL" em vez de "Cover URL" (opcional, nice-to-have).

Comportamento: o campo de URL não fica mais sempre visível; fica atrás do botão. O upload e o botão de URL ficam lado a lado da miniatura, como na lista.

CSS novo sugerido (ajustar aos tokens):
```css
.capa-bloco { display: flex; gap: 12px; align-items: flex-start; }
.capa-bloco-controles { display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0; }
.capa-preview-vazia {
  width: 100px; aspect-ratio: 2 / 3; border-radius: 6px;
  border: 1px dashed var(--border); display: flex; align-items: center;
  justify-content: center; color: var(--text); opacity: 0.5; font-size: 24px;
}
.capa-url-input { width: 100%; }
```

Aplicar o MESMO bloco de capa em `CadastrarPage.tsx` (seção `completo`), substituindo o trio label+uploader+preview de lá pela mesma estrutura, com os estados equivalentes (`capaUrl`/`setCapaUrl`).

---

## Bloco D: Classificação R-15 / R-18

Modelo de dados: campo único `classificacao` ('R-15' | 'R-18' | null) — decidido para evitar estado inválido (uma obra não é R-15 e R-18 ao mesmo tempo). Renderizado como duas caixas onde marcar uma desmarca a outra; clicar na já marcada desmarca (volta a null).

### D1. UI no formulário (DetalheObraPage e CadastrarPage)

Ao lado do Rating, no `.detalhe-obra-grid`, adicionar um bloco no mesmo formato visual do Rating (título em uma linha, controle na linha de baixo):

```tsx
<div className="classificacao-campo">
  <span className="classificacao-label">Content rating</span>
  <div className="classificacao-caixas">
    <label className="check-inline">
      <input
        type="checkbox"
        checked={draft.classificacao === 'R-15'}
        onChange={(e) => setCampo('classificacao', e.target.checked ? 'R-15' : null)}
      />
      R-15
    </label>
    <label className="check-inline">
      <input
        type="checkbox"
        checked={draft.classificacao === 'R-18'}
        onChange={(e) => setCampo('classificacao', e.target.checked ? 'R-18' : null)}
      />
      R-18
    </label>
  </div>
</div>
```

Como marcar uma alterna o valor para aquela e desmarca a outra automaticamente (é o mesmo campo), o comportamento "marcar uma desmarca a outra" sai de graça. Incluir `classificacao` no `Draft` e no `toDraft` de `DetalheObraPage`. Em `CadastrarPage`, adicionar estado `classificacao` e incluir no objeto `NovaObra`.

CSS:
```css
.classificacao-campo { display: flex; flex-direction: column; gap: 6px; }
.classificacao-label { font-size: 14px; }
.classificacao-caixas { display: flex; gap: 12px; }
```

### D2. Badge na lista (ObraCard)

No card da lista, exibir um badge de classificação ANTES do badge de status da obra, na mesma linha de badges. R-18 usa vermelho (`--danger`), R-15 usa amarelo (`--warn`). Só aparece quando `obra.classificacao` não é null.

Localizar em `src/components/ObraCard.tsx` a linha/área onde os badges de status são renderizados e inserir, antes deles:
```tsx
{obra.classificacao && (
  <span className={`badge badge-classificacao ${obra.classificacao === 'R-18' ? 'badge-r18' : 'badge-r15'}`}>
    {obra.classificacao}
  </span>
)}
```
CSS (seguindo o padrão dos badges existentes):
```css
.badge-r18 { background: rgba(209, 38, 79, 0.16); border-color: rgba(209, 38, 79, 0.6); color: var(--text-h); }
.badge-r15 { background: rgba(201, 138, 18, 0.16); border-color: rgba(201, 138, 18, 0.6); color: var(--text-h); }
```
Conferir se o ObraCard renderiza badges tanto no modo grid quanto list; aplicar nos dois se forem caminhos separados.

---

## Bloco E: Autosave de tudo, exceto Notas

Hoje a página inteira usa Save/Cancel manuais com `draft` vs `savedSnapshot`, aviso de "unsaved changes" e `useBlocker`. A dona quer autosave em TODOS os campos, EXCETO Notes, que mantém Save/Cancel próprios.

### E1. Autosave com debounce para todos os campos exceto observacoes

Reformular a lógica de estado do `DetalheObraPage`:

- Manter `draft` como estado editável ligado aos inputs.
- Criar um efeito de autosave: quando `draft` mudar (exceto o campo `observacoes`), após um debounce de ~600ms, chamar `updateObra(id, changesRelevantes)` com os campos que diferem do último estado salvo. Implementar com `useRef` guardando o último snapshot persistido e um `setTimeout` limpo a cada mudança.
  - Excluir `observacoes` do autosave: o efeito compara e persiste todos os campos do draft MENOS `observacoes`.
  - Como `updateObra` já dispara espelhamento e sync, o autosave cobre os campos espelhados naturalmente.
- Remover os botões Save/Cancel gerais e o texto "unsaved changes" que hoje ficam no `.detalhe-obra-acoes` (eles passam a existir só para as Notas, ver E2).
- `useBlocker` e o `beforeunload`: como só as Notas podem ficar sujas agora, o `isDirty` deve refletir APENAS as Notas não salvas. Reaproveitar o mecanismo, mas com o dirty baseado só em `observacoes` (draft vs salvo). Isso mantém a proteção "você tem uma nota não salva" ao sair.

Cuidado importante: o `draft` é reinicializado quando a obra chega/muda (efeito que compara `obra.id !== obraIdCarregado`). O autosave NÃO pode disparar nessa reinicialização (senão re-grava o que acabou de vir do banco). Guardar o snapshot persistido no mesmo momento em que o draft é carregado, e o efeito de autosave só age quando o draft difere desse snapshot. Também pausar/ignorar autosave enquanto `obra === undefined`.

Cuidado com o espelhamento + autosave: digitar no Title dispara autosave após 600ms, que espelha para a obra vinculada. Isso é o comportamento desejado. Só garantir que o debounce evita gravar a cada tecla.

### E2. Notes com Save/Cancel condicionais e ícones

A seção Notes ganha controle próprio:
- Estado separado para a nota: `notaDraft` (editável) e `notaSalva` (último valor persistido). Ao carregar a obra, ambos recebem `obra.observacoes`.
- O `<textarea>` edita `notaDraft`.
- Os botões Save/Cancel da nota ficam OCULTOS quando `notaDraft === notaSalva`, e aparecem só quando há diferença (edição em andamento).
- Posição dos botões: ABAIXO da caixa de escrever a nota (textarea), alinhados à direita (decidido).
- Save: botão de borda transparente com ícone de disquete (💾 ou um SVG de disquete). Ao clicar: `updateObra(id, { observacoes: notaDraft || null })`, depois `notaSalva = notaDraft`.
- Cancel: botão de borda transparente com ícone X em vermelho. Ao clicar: `notaDraft = notaSalva` (descarta).

Estrutura sugerida:
```tsx
<label>
  Notes
  <textarea value={notaDraft ?? ''} onChange={(e) => setNotaDraft(e.target.value || null)} rows={4} />
</label>
{notaDraft !== notaSalva && (
  <div className="notas-acoes">
    <button type="button" className="btn-icone" onClick={handleSalvarNota} aria-label="Save notes" title="Save notes">
      {/* ícone disquete */}
    </button>
    <button type="button" className="btn-icone btn-icone-perigo" onClick={handleCancelarNota} aria-label="Discard notes" title="Discard notes">
      {/* ícone X */}
    </button>
  </div>
)}
```
CSS para botões de ícone com borda transparente:
```css
.btn-icone {
  background: none; border: 1px solid transparent; border-radius: 6px;
  padding: 4px 6px; cursor: pointer; color: var(--text-h);
  display: inline-flex; align-items: center; justify-content: center;
}
.btn-icone:hover { border-color: var(--border); }
.btn-icone-perigo { color: var(--danger); }
.notas-acoes { display: flex; gap: 6px; justify-content: flex-end; }
```
Para os ícones, usar SVG inline (disquete e X). Não adicionar biblioteca de ícones só para isso; dois SVGs inline bastam. Se o projeto já tiver algum conjunto de ícones, reutilizar.

---

## Bloco F: Fontes — renomear botões, tamanho de fonte e reordenação

### F1. Renomear botões

- "Create corresponding work" -> "Create" (no bloco de vínculo do `DetalheObraPage`).
- "Add Source" / o botão de adicionar fonte -> "Add". Conferir o texto exato hoje (o form de nova fonte usa um botão; localizar em `.nova-fonte-form`).

### F2. Tamanho da fonte dos botões "Add" igual ao "Upload image"

O botão de Upload usa `.upload-capa-botao` com `font-size: 13px`. Ajustar os botões "Add" (o de adicionar fonte e o "Add" do TagPicker, se a dona se referir a ambos — o pedido cita "os botões de Add") para `font-size: 13px`, casando com o upload. Verificar qual(is) botão(ões) "Add" ela quer: há o "Add" do form de nova fonte e o "Add" dentro do TagPicker. Aplicar aos dois para consistência; se algum destoar visualmente, priorizar o do form de fontes (que é o vizinho do contexto de Sources).

### F3. Reordenação de fontes por drag and drop

Requisito: abaixo do título "Sources", um botão de editar (borda transparente, ícone de três tracinhos horizontais empilhados). Ao clicar, entra em modo de edição: cada fonte cadastrada ganha um handle (ícone de tracinho) à esquerda e pode ser arrastada para reordenar. Após qualquer alteração de ordem, aparecem ao lado (do botão de editar) dois botões: salvar (ícone disquete) e cancelar (ícone X vermelho). Salvar persiste a nova ordem; cancelar reverte.

Implementação:

1. Dependência nova: `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` (suporte a toque confiável no iOS, ao contrário da HTML5 DnD nativa). Adicionar ao `package.json`.
2. Coluna `ordem` (Bloco A) governa a exibição. Ao listar as fontes no `DetalheObraPage`, ordenar por `ordem` ascendente; fontes com `ordem == null` (legadas) caem por último, desempate por `criado_em`. Para fontes novas (`handleAdicionarFonte`), definir `ordem` como (maior ordem atual + 1) no momento da criação, para já entrarem no fim da lista.
3. Estado de modo de edição: `const [editandoOrdem, setEditandoOrdem] = useState(false)` e uma cópia local da ordem sendo editada `const [ordemLocal, setOrdemLocal] = useState<Fonte[]>([])`.
   - Ao entrar em modo edição, `ordemLocal` recebe a lista atual ordenada.
   - Arrastar reordena `ordemLocal` (via `arrayMove` do dnd-kit), sem persistir ainda.
   - `alterou` = `ordemLocal` difere da ordem original.
4. Botão de editar abaixo do `<h2>Sources</h2>`: `.btn-icone` com ícone de três tracinhos (SVG: três linhas horizontais). Alterna `editandoOrdem`.
5. Quando `editandoOrdem`, envolver a lista num `<DndContext>` + `<SortableContext>`; cada `FonteItem` vira sortable com um handle (ícone de tracinho/grip à esquerda). Durante o modo de edição, OCULTAR os botões Approve/Reject/Delete e o select de tipo de cada fonte (decidido — card limpo, sem clique acidental). O handle é o único ponto de arraste (usar `listeners` do dnd-kit só no handle).
6. Quando `alterou`, exibir ao lado do botão de editar: botão salvar (disquete) e cancelar (X vermelho).
   - Salvar: gravar a nova `ordem` de cada fonte afetada via `updateFonte(fonte.id, { ordem: novoIndice })`. Para minimizar escritas, só atualizar as que mudaram de índice. Depois, sair do modo edição.
   - Cancelar: descartar `ordemLocal`, sair do modo edição sem gravar.
7. `updateFonte` já dispara `recalcUltimoCapituloLancado` e sync; reordenar não muda capítulo, mas o recalc é idempotente. Se quiser evitar recalc à toa na reordenação, é aceitável (nice-to-have) criar um caminho que atualize só `ordem` sem recalcular — mas não é obrigatório; priorizar corretude.

Ícones necessários (SVG inline): grip/tracinhos (para o handle e para o botão de editar), disquete (salvar), X (cancelar). Reaproveitar os SVGs de disquete/X do Bloco E.

CSS:
```css
.fontes-cabecalho { display: flex; align-items: center; gap: 8px; }
.fonte-handle { cursor: grab; touch-action: none; display: inline-flex; color: var(--text); opacity: 0.6; }
.fonte-item.arrastando { opacity: 0.5; }
```

---

## Bloco G: Filtros de gênero/tag mostrando TODAS as opções

Problema: o `TagPicker` limita as sugestões a 8 (`.slice(0, 8)`), tanto no filtro da lista principal quanto no formulário de criar/editar obra. A dona quer ver TODAS as opções cadastradas ao abrir, com rolagem, mantendo o formato atual (dropdown de sugestões já existente, que já tem `max-height: 200px; overflow-y: auto`).

Correção em `src/components/TagPicker.tsx`:
- Remover o `.slice(0, 8)` do cálculo de `sugestoes`, OU aumentar o limite para um valor alto o suficiente que não corte na prática. Preferir remover o slice: o container `.tag-picker-sugestoes` já rola (max-height 200px + overflow-y auto), então mostrar todas e deixar rolar é exatamente o pedido.
- Manter o filtro por texto digitado (quando a dona digita, continua filtrando por `includes`). O comportamento desejado é: dropdown aberto sem texto mostra TODAS as opções (roláveis); com texto, filtra.
- Como agora a lista pode ser longa, confirmar que o dropdown abre no foco (`onFocus` já seta `aberto`) e que a rolagem dentro dele funciona no iOS (o `overflow-y: auto` já cobre; garantir que não há `overflow: hidden` num ancestral cortando).

Isso vale automaticamente para os dois usos (filtro da lista em `ListaPrincipalPage` e os TagPickers de Genres/Tags em `DetalheObraPage`/`CadastrarPage`), já que todos usam o mesmo componente.

Atenção: o TagPicker também é usado para "Alternative title" com `options={[]}` (sem sugestões). Remover o slice não afeta esse caso (lista vazia continua vazia).

---

## Checklist de verificação

- [ ] Migração SQL criada; `classificacao` em obras e `ordem` em fontes existem nos tipos e em todos os literais de objeto
- [ ] `npm run build` e `npm run lint` passam
- [ ] Editar Title/Alternative title/Genres/Tags numa obra vinculada reflete na correspondente (espelhamento contínuo dos 4 campos)
- [ ] Criar obra correspondente inline copia título, títulos alternativos, gêneros e tags iniciais
- [ ] Vincular duas obras já existentes deixa o vínculo mútuo (A↔B) sem sobrescrever campos na hora
- [ ] Ordem das seções na página de obra: capa acima das notas; Delete work no final absoluto (após Sources)
- [ ] Bloco de capa: miniatura à esquerda, Upload + botão de URL à direita; input de URL oculto até clicar no botão; mesmo layout em Cadastrar
- [ ] R-15/R-18 ao lado do Rating (título em cima, caixas embaixo); marcar uma desmarca a outra; clicar na marcada limpa
- [ ] Badge de classificação na lista antes do status: vermelho R-18, amarelo R-15
- [ ] Autosave funciona em todos os campos exceto Notes; sem botões Save/Cancel gerais; sem re-gravação ao só carregar a obra
- [ ] Notes: Save (disquete) e Cancel (X vermelho) com borda transparente, ocultos até haver edição, abaixo do textarea, alinhados à direita
- [ ] Botões renomeados: "Create" (era Create corresponding work), "Add" (era Add Source)
- [ ] Botões "Add" com font-size igual ao "Upload image" (13px)
- [ ] Reordenação de fontes: botão de editar (3 tracinhos) abaixo de Sources; handles aparecem; arrasta no toque (iOS); salvar/cancelar surgem após mudança; ordem persiste
- [ ] Durante a reordenação, ações da fonte (Approve/Reject/Delete/tipo) ficam ocultas
- [ ] TagPicker mostra todas as opções ao abrir (com rolagem), no filtro da lista e no form de obra
- [ ] Testado num viewport de ~390px (iOS) sem sobreposição nem estouro de layout
```

## Perguntas de acompanhamento embutidas (não bloqueiam; decidir se aparecerem)
- Se o projeto já tiver um handout anterior com `mensagemDeErro`/`useAsyncAction` implementados, reutilizá-los nos novos handlers em vez de recriar padrão de erro.
- Se `src/sync/sync.ts` usar mapeamento explícito coluna↔campo, incluir `classificacao` e `ordem` nele; se usar `bulkPut` do objeto cru, nada a fazer.
