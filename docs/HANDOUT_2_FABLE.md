# Handout 2 de 2 (executar com Fable): revisão do Handout 1 + itens de maior complexidade

Repositório: `blair-boo/manga-lists` (PWA Ratsnest: Vite + React + TS, Dexie, Supabase, scrapers Python em GitHub Actions).

Pré-requisito: o Handout 1 (`docs/HANDOUT_1_SONNET.md`) já foi executado por outro modelo. Sua primeira tarefa é REVISAR esse trabalho antes de implementar qualquer coisa nova. Depois da revisão, implemente os itens B1, A5, E2, B5 e D1 abaixo, nesta ordem.

Item explicitamente FORA de escopo permanente: o texto "site: titulo-no-site" nos cards da fila de aprovação (função `tituloNoSite`) fica exatamente como está. É usado para conferência manual. Não remover, não condicionar.

---

## Fase 0: Revisão do trabalho do Handout 1

Revise item a item o que foi implementado, corrigindo o que estiver errado ou incompleto antes de seguir. Ao final, escreva um resumo curto do que estava ok e do que precisou de ajuste.

Pontos de verificação por item (além de ler o diff/código):

**A3 (helper de erro):**
- `src/lib/erros.ts` existe com `mensagemDeErro` cobrindo Error, string, objeto com message/error_description/error/details/hint, e fallback JSON.stringify.
- grep por `instanceof Error ?` e por `String(err)` em exibição de UI: nenhuma ocorrência restante fora do próprio helper.
- Erros do `supabase.functions.invoke` (FunctionsHttpError) e do PostgREST resultam em texto legível, não `[object Object]`.

**A1 (URL truncada):**
- `.fonte-link` sem `word-break: break-all`; com display block + ellipsis.
- `title={f.url}` presente no link em `FilaAprovacoes.tsx`.
- Cadeia de flex permite truncar: verificar `min-width: 0` onde necessário (um erro comum é o ellipsis não funcionar porque um ancestral flex não encolhe).

**A2 (layout mobile do card):**
- Media query 640px empilha `.fonte-aprovacao` em coluna; `.fonte-acoes` sem `margin-left: auto` no mobile.
- Desktop inalterado.

**A4 (estado de processamento):**
- Botões e select desabilitam durante a ação; sem possibilidade de clique duplo.
- Erro de ação exibido com `mensagemDeErro`.

**A7 (contagens nos chips):** contagens corretas por escopo (`pertence`) e por status; blacklist usa `blacklist.length`.

**B2 (recalc sem gravação redundante):**
- `recalcUltimoCapituloLancado` compara antes de gravar. Teste mental: editar o capítulo de uma fonte para o mesmo valor não deve enfileirar mutação de obra.
- Atenção a null vs undefined na comparação (o valor calculado é `null` quando não há fontes aprovadas; comparar com `??` normalizado, não com `===` ingênuo entre null e undefined).

**B3 (useAsyncAction):**
- Hook criado; componentes refatorados sem mudança de comportamento visível.
- Verificar que o `useCallback` do hook não cria loop de re-render nos componentes refatorados (a `fn` passada deve ser estável ou o hook usado de forma que não importe).

**B4 (dedupe via índice):** `equalsIgnoreCase` no índice `titulo`; comportamento de `jaExistia` preservado.

**C1/C2/C3 (scraper):**
- C1: `obras` e `fontes` carregadas uma vez no `main()` de `update_obras.py`.
- C2: retry só em erro de rede/5xx, NUNCA em 403/503 tipo Cloudflare.
- C3: migração SQL criada em `supabase/`, `finalizar_run` retrocompatível, os três estágios preenchem `resumo`, `StatusExecucaoScraper.tsx` exibe. Atenção: se a coluna `resumo` ainda não existir no banco (migração é manual), o scraper NÃO pode quebrar; o insert/update do resumo deve ser tolerante ou o handout 1 deve ter deixado isso claro no código. Se estiver frágil, corrigir.

**D2/D3/E1:** componentes extraídos sem mudança de comportamento; docs/ existe com os handouts (ou o placeholder de faltantes); nome do app centralizado nos 3 pontos.

**Geral:** `npm run build` e `npm run lint` passam; nenhuma regressão de comportamento nas telas de List, Detalhe e Updates.

---

## B1. Deletes remotos nunca chegam ao Dexie local (pullObras incremental)

Problema: `pullObras` em `src/sync/sync.ts` é incremental via `atualizado_em`. Uma obra apagada no servidor (outro dispositivo, ou direto no Supabase) nunca é removida do IndexedDB local.

Correção (reconciliação de IDs, barata para o volume atual de ~500 obras):

1. Depois do pull incremental de obras, buscar apenas os ids do servidor: `supabase.from('obras').select('id')`.
2. Calcular os ids locais ausentes no servidor.
3. GUARDA CRÍTICA: antes de deletar, excluir da lista de remoção qualquer id que tenha mutação pendente na `syncQueue` (`entity === 'obras'` com op insert/update). Isso evita apagar uma obra criada localmente cujo push falhou nesta rodada (offline no meio do ciclo, erro transitório no push, etc.). Este é o ponto mais delicado do item: um erro aqui apaga dados da usuária.
4. Deletar do Dexie os ids restantes, junto com as fontes locais dessas obras (`db.fontes.where('obra_id').anyOf(ids).delete()`).
5. Se a query de ids falhar (offline no meio do ciclo), pular a reconciliação silenciosamente; nunca deletar com base em resposta parcial ou erro.

`pullFontes` e `pullListas` já fazem full refresh (clear + bulkPut), então não precisam de reconciliação.

Antes de finalizar, raciocine explicitamente sobre estes cenários e confirme que a implementação os cobre:
- Obra criada offline, sync roda com push falhando e pull funcionando: a obra local sobrevive.
- Obra apagada no servidor enquanto o app estava fechado: some do local no próximo sync.
- Duas abas/dispositivos sincronizando quase juntos: sem deleção indevida (o flag `syncing` já serializa dentro de uma aba; entre dispositivos a guarda da syncQueue cobre).

## A5. Ações em massa na fila de aprovações

Motivação: filas com 50+ pendências tornam a aprovação item a item inviável.

Implementar em `FilaAprovacoes.tsx`, ativo apenas no filtro `pendente`:

1. Checkbox em cada item pendente (`<input type="checkbox">` no início do `.fonte-item`), controlado por `const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())`.
2. Por grupo de obra, um link/botão pequeno "Select all" ao lado do título da obra, que adiciona todas as fontes pendentes daquele grupo à seleção (e alterna para "Deselect all" quando todas já estão selecionadas).
3. Quando `selecionadas.size > 0`, exibir uma barra fixa no topo do corpo da fila: `N selected` + botões `Approve selected` e `Reject selected`.
4. As ações em massa iteram sequencialmente sobre os ids, com estado de progresso (`Approving 3/12…`) e desabilitando a barra durante a execução. Ao final, limpar a seleção. Erros individuais não interrompem o lote; acumular e exibir um resumo (`2 failed: ...` via `mensagemDeErro`).
5. Trocar de filtro ou fechar a fila limpa a seleção. Atenção: como a lista é `useLiveQuery`, itens aprovados somem da visão `pendente` durante o lote; a iteração deve ser sobre a cópia dos ids capturada no clique, não sobre a lista reativa.
6. Sem Blacklist em massa (é destrutivo por domínio; permanece individual com o diálogo de confirmação).
7. Compatibilidade com o A4: o estado de processamento individual e o de lote não podem conflitar (durante um lote, os botões individuais ficam desabilitados).

CSS: barra `.fila-acoes-massa` com `display: flex; align-items: center; gap: 8px;` seguindo os tokens existentes; checkboxes com área de toque de pelo menos 24px no mobile.

## E2. Substituir confirm() e prompt() nativos por modais do app

Motivação: no iOS PWA standalone, os diálogos nativos fogem do tema e o `prompt()` é limitado.

1. Criar `src/components/Dialogo.tsx` com dois componentes controlados usando as classes `.modal-backdrop`/`.modal`/`.modal-acoes` que já existem no CSS:
   - `ConfirmDialog`: `{ aberto, titulo?, mensagem, confirmarRotulo?, perigoso?, onConfirmar, onCancelar }`. Quando `perigoso`, o botão de confirmação usa o estilo de `danger`.
   - `PromptDialog`: `{ aberto, titulo?, mensagem, valorInicial?, onConfirmar(valor), onCancelar }` com um `<input type="text">` autofocado; Enter confirma, Esc cancela.
2. Para minimizar boilerplate, criar um hook `useDialogos()` (ou provider) que exponha `confirmar(opts): Promise<boolean>` e `pedirTexto(opts): Promise<string | null>`, renderizando os diálogos uma vez no `Layout`.
3. Substituir os usos de `confirm()` e `prompt()`:
   - `DetalheObraPage.tsx`: excluir obra, desvincular, mudança de tipo de fonte com criação de contraparte, `prompt` do título da obra vinculada
   - `FilaAprovacoes.tsx`: confirm de blacklist (individual)
   - `AprovacaoDominios.tsx`: confirm de rejeição de domínio
4. Acessibilidade mínima: `role="dialog"`, `aria-modal="true"`, foco preso no diálogo enquanto aberto, Esc fecha.
5. Cuidado com fluxos encadeados (ex.: `handleMudarTipoFonte` confirma e depois cria obra vinculada com prompt de título): a versão com Promises precisa preservar a sequência e os cancelamentos em cada etapa exatamente como hoje.

## B5. Testes mínimos (funções puras)

Frontend (Vitest):

1. Adicionar devDependency `vitest` e script `"test": "vitest run"` no `package.json`.
2. Exportar `tituloNoSite` de `FilaAprovacoes.tsx` (ou movê-la para `src/lib/`), para ser testável.
3. Criar testes para funções puras, sem tocar em UI nem em Dexie/Supabase:
   - `dominioDeUrl` (URLs válidas, com www, inválidas)
   - `tituloNoSite` (slug com hífens, URL inválida, path vazio)
   - `mensagemDeErro` (Error, string, PostgrestError-like, objeto sem message)
   - `parseCsvFile` / `buildUpdatePayload` / `obrasParaCsv` de `csvBulkUpdate` (célula vazia mantém valor, arrays com `;`, formatos `{a,b}` e JSON)
   - `familiaDeTipo` e `temNovoCapitulo` de `lib/obra`
4. Adicionar step `npm test` no workflow de deploy (antes do build), falhando o deploy se os testes quebrarem.

Scraper (pytest):

1. Adicionar `pytest` ao `scraper/requirements-dev.txt` (novo arquivo; não poluir o requirements de produção usado pelo Actions).
2. Criar `scraper/tests/fixtures/` com trechos mínimos de HTML real já disponíveis no repo/handouts (nyxscans `__next_f`, ezmanga `ng-state`, um exemplo Madara). Se algum HTML de exemplo não estiver disponível no repositório, criar o teste com um fixture sintético mínimo que exercite o parser e registrar num comentário que falta o HTML real.
3. Testes de parse por adaptador: dado o fixture, `parse` retorna `STATUS_OK` com o capítulo esperado; dado HTML fora do formato, retorna `STATUS_INVALIDA` (não exceção).
4. Testes de `match_titulo.decidir_status` nos limiares (abaixo do mínimo, entre mínimo e auto, acima do auto).
5. Workflow opcional `scraper-tests.yml` rodando pytest em push que toque em `scraper/` (path filter).

## D1. Dividir o index.css (por último)

Dividir `src/index.css` em arquivos por área, importados na mesma ordem no topo de um `index.css` enxuto (ou em `main.tsx`):

- `styles/base.css`: tokens/:root, temas, resets, tipografia, botões/inputs genéricos, toasts, modal
- `styles/layout.css`: header, nav, sync, responsivo geral
- `styles/lista.css`: busca, filtros, chips, grid, obra-card
- `styles/detalhe.css`: formulário de obra, fontes, vínculo, capa
- `styles/updates.css`: seções de Updates, sites suportados, domínios, fila de aprovações (incluindo o CSS novo do A5), config de match

Regra: mover, não reescrever. Nenhum seletor ou valor muda neste item; é só reorganização. Fazer por último, depois de todo o CSS novo deste handout já existir.

Incluir este handout no repo como `docs/HANDOUT_2_FABLE.md`.

---

## Checklist de verificação final (cobre os dois handouts)

- [ ] Resumo da Fase 0 escrito: o que estava ok, o que foi ajustado
- [ ] `npm run build`, `npm run lint` e `npm test` passam
- [ ] Card de aprovação no viewport de 390px: URL em 1 linha com ellipsis, nada sobreposto, botões clicáveis
- [ ] Aprovar em massa 3+ fontes funciona, com progresso, resumo de falhas e seleção limpa ao final
- [ ] Apagar uma obra direto no Supabase e sincronizar remove a obra e suas fontes do app (B1)
- [ ] Obra local com push pendente NÃO é apagada pela reconciliação (B1, guarda da syncQueue)
- [ ] Nenhum `confirm(` ou `prompt(` nativo restante no src (grep)
- [ ] Fluxo encadeado de mudança de tipo de fonte (confirmar + título da contraparte) funciona com os novos diálogos
- [ ] pytest do scraper passa localmente
- [ ] O texto "site: titulo-no-site" dos cards de aprovação continua presente
