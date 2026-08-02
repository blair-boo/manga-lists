# Handout 1 de 2 (Sonnet): base do Edit mode na aba List

Repositório: `blair-boo/manga-lists` (Ratsnest). Stack: Vite + React + TypeScript + Dexie + Supabase.

Este handout cobre **só as extrações mecânicas e a infraestrutura**. O modo de edição em si (contexto, botão, card editável, modais de campo) vem no Handout 2, executado por outro modelo, e depende de tudo aqui estar pronto. Nada neste handout muda comportamento visível do app, com duas exceções declaradas: o X novo nos modais (Bloco A1) e os dois chips de filtro novos (Bloco A5).

Regra geral: **mover e generalizar, não reescrever**. Onde já existe um padrão no projeto, seguir o padrão em vez de inventar outro.

---

## Bloco A1: `ModalBase` com X de fechar, aplicado a todos os modais

Hoje existem três formas diferentes de modal no app:

1. `.modal-backdrop` + `.modal` + `.modal-acoes` cru (modal de notas não salvas em `DetalheObraPage.tsx`).
2. `ConfirmDialog` / `PromptDialog` em `src/components/Dialogo.tsx`, com `useFocoPreso` e Esc.
3. O modal de resultado da aba Add (`CadastrarPage.tsx`), único que tem o X, via `.cadastro-rapido-resultado-wrap` + `.cadastro-rapido-resultado-fechar` (X posicionado FORA da caixa, canto superior direito).

A dona quer o X do item 3 em **todos** os modais do app.

### A1.1. Criar `src/components/ModalBase.tsx`

```tsx
interface ModalBaseProps {
  aberto: boolean;
  /** Rótulo acessível do diálogo. */
  rotulo: string;
  /** Chamado pelo X, pelo Esc e pelo clique no backdrop. */
  onFechar: () => void;
  /** Classe extra no .modal (ex.: 'cadastro-rapido-resultado'). */
  classe?: string;
  children: ReactNode;
}
```

Responsabilidades do componente:

- Renderiza `null` quando `aberto` é false.
- Estrutura: `.modal-backdrop` > `.modal-wrap` (novo, `position: relative`) > botão `.modal-fechar` (o X) + `.modal` com `role="dialog"` e `aria-modal="true"`.
- Move para dentro dele o hook `useFocoPreso` que hoje vive em `Dialogo.tsx` (exportar de `ModalBase.tsx` e importar no `Dialogo.tsx`, ou manter em `Dialogo.tsx` e importar aqui; escolher um lugar só, sem duplicar).
- `Escape` chama `onFechar`.
- Clique no backdrop (`onClick` no próprio `.modal-backdrop`, checando `e.target === e.currentTarget`) chama `onFechar`. Clique dentro da caixa não fecha.
- O X é `<button type="button" className="modal-fechar" aria-label="Close">×</button>`.

### A1.2. CSS

Em `src/styles/base.css`, na seção `/* Modal */`, generalizar o CSS que hoje está em `detalhe.css` como `.cadastro-rapido-resultado-fechar`:

```css
.modal-wrap {
  position: relative;
}

/* X fora da caixa, no canto superior direito (padrão de todos os modais). */
.modal-fechar {
  position: absolute;
  top: -14px;
  right: -14px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-h);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  z-index: 1;
}
```

Remover `.cadastro-rapido-resultado-wrap` e `.cadastro-rapido-resultado-fechar` de `src/styles/detalhe.css` depois que `CadastrarPage` migrar. Manter `.cadastro-rapido-resultado` (tamanho de fonte), que é conteúdo, não estrutura.

Atenção ao viewport estreito: com `top: -14px; right: -14px`, o X pode encostar na borda da tela em telas pequenas. O `.modal-backdrop` já tem `padding: 20px`, o que dá folga suficiente. Conferir a 360px.

### A1.3. Migrar os três usos

- **`Dialogo.tsx`:** `ConfirmDialog` e `PromptDialog` passam a renderizar seu conteúdo dentro de `ModalBase`, com `onFechar` apontando para o `onCancelar` de cada um. O botão "Cancel" continua existindo dentro do diálogo; o X é adicional, não substituto.
- **`CadastrarPage.tsx`:** trocar a estrutura manual pelo `ModalBase` com `classe="cadastro-rapido-resultado"` e `onFechar={() => setResultado(null)}`. Comportamento idêntico ao de hoje.
- **`DetalheObraPage.tsx`, modal do `blocker` (notas não salvas):** usar `ModalBase` com `onFechar={() => blocker.reset()}`.

**Regra importante, deixar como comentário no código:** no modal de notas não salvas, o X significa "Keep editing". O X **nunca** descarta dados. Se um modal futuro tiver um caminho destrutivo, o X é sempre o caminho seguro (cancelar).

### A1.4. Varredura

`grep -rn "modal-backdrop" src/` e conferir que nenhum uso restante monta o backdrop na mão. Todo modal do app deve passar por `ModalBase`.

---

## Bloco A2: ícones do rato

Os dois ícones vivem no bucket `icons` do Supabase Storage, como os demais SVGs fornecidos pela dona.

### A2.1. Renderização colorida (diferente do padrão atual)

`Icones.tsx` hoje usa `IconeMascarado`, que pinta o SVG com `currentColor` via `mask-image`. O ícone do rato precisa **manter as cores do próprio arquivo** (o vermelho não pode ser sobrescrito pelo tema). Isso exige `<img>`, não máscara.

Adicionar em `src/components/Icones.tsx`:

```tsx
/**
 * Ícone do Supabase Storage renderizado como <img>, preservando as cores do
 * arquivo. Usar quando o SVG tem cor própria que NÃO deve seguir o tema
 * (caso do rato do Edit mode, que mantém o vermelho). Para ícones que devem
 * acompanhar o tema, usar IconeMascarado.
 */
function IconeColorido({ arquivo, largura, altura }: { arquivo: string; largura: number; altura: number }) {
  return (
    <img
      className="icone-colorido"
      src={urlIconeSupabase(arquivo)}
      width={largura}
      height={altura}
      alt=""
      aria-hidden
      draggable={false}
    />
  );
}

// Nomes dos arquivos no bucket "icons".
const ARQUIVO_MODO_EDICAO = 'mini-mouse-inverted.svg';
const ARQUIVO_SAIR_MODO_EDICAO = 'mini-mouse-no-inverted.svg';

const RATO_LARGURA = 20;
const RATO_ALTURA = 30;

/** Rato: entrar no Edit mode da aba List. */
export function IconeModoEdicao() {
  return <IconeColorido arquivo={ARQUIVO_MODO_EDICAO} largura={RATO_LARGURA} altura={RATO_ALTURA} />;
}

/** Rato riscado: sair do Edit mode (usado no header e no botão flutuante). */
export function IconeSairModoEdicao() {
  return <IconeColorido arquivo={ARQUIVO_SAIR_MODO_EDICAO} largura={RATO_LARGURA} altura={RATO_ALTURA} />;
}
```

`urlIconeSupabase` já existe no arquivo; reaproveitar, não duplicar.

### A2.2. CSS

Em `src/styles/base.css`, junto de `.icone-mascarado`:

```css
/* Ícone do Storage com cores próprias (não segue o tema). */
.icone-colorido {
  display: block;
  flex-shrink: 0;
}

/* Botão de ícone em estado "só a sombra": visível, mas inerte. Mesma opacidade
   do .obra-card-nu-botao-vazio, pra o app ter um vocabulário visual só. */
.btn-icone-sombra {
  opacity: 0.35;
  cursor: default;
  pointer-events: none;
}
```

O botão em si usa a classe `.btn-icone` que já existe e já é exatamente o que a dona pediu (`padding: 1px 1px; border: 1px solid #0000;`). Não criar classe nova para isso.

---

## Bloco A3: extrair a gravação de campos da obra

**Motivação:** hoje, mudar `titulo` ou `tipo` na `DetalheObraPage` dispara `renomearCapaSeNecessario` antes do `updateObra`, e é isso que mantém o nome determinístico do arquivo no bucket `capas`. O Handout 2 vai gravar esses mesmos campos a partir da lista. Se a lista chamar `updateObra` cru, o título muda e a capa fica com o slug antigo, silenciosamente.

### A3.1. Criar `src/lib/salvarObra.ts`

```ts
/**
 * Ponto único de gravação de campos da obra fora do fluxo de criação.
 * Cuida do rename da capa quando titulo/tipo mudam e delega o resto pro
 * updateObra (que já faz enqueue, sync e espelhamento manga<->novel).
 * Usado pelo autosave da tela da obra e pelo Edit mode da lista.
 */
export async function salvarCamposObra(
  obra: Pick<Obra, 'id' | 'titulo' | 'tipo' | 'capa_url'>,
  changes: Partial<NovaObra>,
  aoFalharRename?: (mensagem: string) => void
): Promise<void>
```

Corpo: mover para cá, sem alterar a lógica, o trecho que hoje está dentro do `setTimeout` do efeito de autosave de `DetalheObraPage.tsx`:

- Se `'titulo' in changes || 'tipo' in changes` e existe `capa_url` anterior, chamar `renomearCapaSeNecessario(capaAnterior, tituloAnterior, tipoAnterior, novoTitulo, novoTipo)`; se devolver URL nova, incluir `capa_url` no patch.
- Falha no rename não aborta a gravação: chamar `aoFalharRename(mensagemDeErro(err))` e seguir com os demais campos.
- Ao final, `await updateObra(obra.id, changes)`.

Os "valores anteriores" vêm do primeiro argumento (`obra`), e os novos de `changes` com fallback para os anteriores quando o campo não estiver no patch.

### A3.2. Usar na `DetalheObraPage`

O efeito de autosave passa a chamar `salvarCamposObra(...)` com o snapshot anterior e as `changes`, e `aoFalharRename` ligado a `mostrarToast(..., 'erro')`. Nenhuma mudança de comportamento: mesma sequência, mesmo debounce de 600ms, mesma atualização do `snapshotRef` antes do await.

`CadastrarPage.tsx` faz um rename equivalente no submit, mas com dados que ainda não existem no banco (obra sendo criada). **Não** mexer nela.

---

## Bloco A4: extrair o upload de capa

**Motivação:** o Edit mode abre o seletor de arquivo clicando na capa do card, que tem markup próprio (`.obra-card-capa`), diferente da miniatura da tela da obra (`.capa-preview`). O `CapaUploader` de hoje mistura a lógica de upload com a marcação da miniatura.

### A4.1. Criar o hook em `src/components/CapaUploader.tsx` (mesmo arquivo)

```tsx
export function useUploadCapa({
  titulo,
  tipo,
  onUploaded,
}: {
  titulo: string;
  tipo: Tipo | null;
  onUploaded: (url: string) => void;
}) {
  // devolve { enviando, erro, abrirSeletor, inputProps }
}
```

- `abrirSeletor()`: o mesmo comportamento de hoje, incluindo o bloqueio com a mensagem `Fill in the title before uploading a cover.` quando o título está vazio.
- `inputProps`: as props do `<input type="file" accept="image/*" hidden>` (ref e onChange), para quem usa o hook só espalhar num input próprio.
- O `onChange` mantém a lógica atual: `uploadCapa(file, titulo, tipo)`, `onUploaded(url)`, tratamento de erro com `Failed to upload image.`, e o `e.target.value = ''` antes de tudo.

### A4.2. Refatorar `CapaUploader` para consumir o hook

O componente continua exportado com a mesma interface pública (`capaUrl`, `titulo`, `tipo`, `onUploaded`) e a mesma marcação. Nenhuma mudança visível nas telas de obra e de cadastro.

---

## Bloco A5: extrair a criação de fonte

**Motivação:** o Edit mode adiciona sources direto da lista. Se ele montar o objeto `NovaFonte` por conta própria, o modelo de dois estados (fonte existe vs domínio aprovado para scraping) é contornado, e a `ordem` e o `tipo_detectado` saem errados.

### A5.1. Criar `src/lib/adicionarFonte.ts`

```ts
/**
 * Cria uma fonte manual numa obra, no mesmo formato usado pela tela da obra:
 * site derivado da URL, ordem no fim da lista, tipo herdado da obra e registro
 * do domínio como site suportado. Ponto único usado pela tela da obra e pelo
 * Edit mode da lista.
 */
export async function adicionarFonteNaObra(
  obraId: string,
  url: string,
  tipoObra: Tipo | null,
  fontesAtuais: Fonte[]
): Promise<void>
```

Mover para cá, sem alterar, o corpo do `handleAdicionarFonte` de `DetalheObraPage.tsx` (do cálculo de `maiorOrdem` até o `registrarDominioManual(url)`), incluindo os comentários explicativos que já existem lá.

### A5.2. Usar na `DetalheObraPage`

`handleAdicionarFonte` fica com: `preventDefault`, guarda de string vazia, chamada ao helper, `setNovaFonteUrl('')`.

---

## Bloco A6: dois filtros novos, "No rating" e "No type"

Mesmo padrão dos três chips de lacuna que já existem (`Unsourced`, `No cover`, `No NU link`): três estados (`off` → `incluir` → `excluir` → `off`) e contagem no `.status-chip-contagem`.

- **No rating:** obras sem nota. Condição: `o.nota == null` (cobre `null` e `undefined` de registros locais antigos; **não** usar `!o.nota`, que trataria nota 0 como ausente).
- **No type:** obras sem tipo. Condição: `!o.tipo`.

### A6.1. `src/lib/filtrosLista.ts`

Adicionar `filtroSemNota` e `filtroSemTipo` (tipo `EstadoFiltro`) em `FiltrosSalvos`, em `FILTROS_PADRAO` (ambos `'off'`), em `lerFiltrosSalvos()` (via `estadoFiltroValido`) e em `temFiltroAtivo`.

Em `obrasFiltradasOrdenadas`, encadear logo depois de `filtroSemNu`:

```ts
.filter((o) => passaFiltro(filtros.filtroSemNota, o.nota == null))
.filter((o) => passaFiltro(filtros.filtroSemTipo, !o.tipo))
```

**Cuidado conhecido deste arquivo:** adicionar campo em `FiltrosSalvos` sem incluir em `temFiltroAtivo` faz o botão `Clear filters` sumir silenciosamente para aquele filtro. Conferir os cinco lugares.

### A6.2. `src/pages/ListaPrincipalPage.tsx`

Dois estados novos no padrão dos existentes, incluídos no objeto persistido pelo `useEffect`, no array de dependências, em `limparFiltros()`, e duas contagens memoizadas:

```ts
const contagemSemNota = useMemo(() => (obras ?? []).filter((o) => o.nota == null).length, [obras]);
const contagemSemTipo = useMemo(() => (obras ?? []).filter((o) => !o.tipo).length, [obras]);
```

Os chips no JSX vão logo depois de `No NU link`, com rótulos `No rating` e `No type` e classes `status-chip-sem-nota` e `status-chip-sem-tipo`.

**Nota para o Handout 2:** estes dois chips, junto com os três existentes de lacuna, passarão a aparecer só no Edit mode. Deixe-os visíveis normalmente por enquanto; o Handout 2 cuida da visibilidade condicional.

### A6.3. Testes

Em `src/lib/filtrosLista.test.ts`, no padrão dos testes de `filtroSemCapa`:

- `filtroSemNota` em `incluir` mostra só obras sem nota; em `excluir`, some com elas.
- Nota `0` **não** conta como ausente.
- `filtroSemTipo` em `incluir` mostra só obras sem tipo.

---

## Bloco A7: cache offline dos ícones do Storage

O botão do rato passa a ser permanente no header, e os SVGs do bucket `icons` não são pré-cacheados pelo Workbox (até agora só a aba Tests os usava). Sem isso, o ícone some quando o PWA abre offline.

Em `vite.config.ts`, dentro das opções de `VitePWA`, na chave `workbox` (se já existir, **acrescentar** ao array existente em vez de substituir):

```ts
runtimeCaching: [
  {
    urlPattern: ({ url }) => url.pathname.includes('/storage/v1/object/public/icons/'),
    handler: 'StaleWhileRevalidate',
    options: {
      cacheName: 'icones-supabase',
      expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
      cacheableResponse: { statuses: [0, 200] },
    },
  },
],
```

Se já houver `runtimeCaching` para o bucket `capas`, seguir o formato de lá em vez do sugerido acima.

---

## Checklist do Handout 1

- [ ] `npm run build`, `npm run lint` e `npm test` passam
- [ ] `grep -rn "modal-backdrop" src/` só devolve `ModalBase.tsx`
- [ ] X aparece nos modais de confirmação, de prompt, no resultado da aba Add e no de notas não salvas
- [ ] X, Esc e clique no backdrop fecham; clique dentro da caixa não fecha
- [ ] X do modal de notas não salvas equivale a "Keep editing" (não descarta a nota)
- [ ] Foco preso dentro do diálogo aberto, com Tab e Shift+Tab circulando
- [ ] `IconeModoEdicao` e `IconeSairModoEdicao` renderizam a 20×30 mantendo as cores do arquivo, nos temas claro e escuro
- [ ] Editar o título na tela da obra continua renomeando a capa no bucket (comportamento preservado após a extração)
- [ ] Adicionar source na tela da obra continua registrando o domínio e entrando no fim da ordem
- [ ] Upload de capa continua bloqueado com título vazio, com a mesma mensagem
- [ ] Chips `No rating` e `No type` aparecem depois de `No NU link`, com contagem correta e três estados
- [ ] Nota `0` não aparece em `No rating`
- [ ] `Clear filters` some quando os cinco filtros de lacuna estão em `off` e aparece quando qualquer um está ativo
- [ ] Testes novos em `filtrosLista.test.ts` passam
- [ ] Ícones do bucket `icons` carregam com a rede desligada, depois de uma visita online
