# HANDOUT_UI_BUSCA_FILTROS_FAVICON

Lote de ajustes de interface: renomear status de leitura, dois filtros novos, campo de busca compartilhado com autocomplete, botão de limpar filtros na tela da obra, e troca do favicon.

**Modelo de execução:** Fable. Toca múltiplos arquivos, extrai lógica compartilhada e inclui migração de dados. Sem Fase 0 (execução por modelo único).

Salvar este handout como `docs/HANDOUT_UI_BUSCA_FILTROS_FAVICON.md`.

---

## Bloco A: `Complete` vira `Finished` no status de leitura

**Motivo:** hoje o status de **leitura** tem `Complete` e o status de **publicação** tem `Completed`. Dois valores quase idênticos em campos diferentes, confusão garantida. O status de leitura passa a `Finished`.

Isto é renomeação de valor de dado, não só de rótulo. Percorrer todos os pontos abaixo; deixar qualquer um de fora quebra o filtro ou apaga o status de obras existentes.

### A1. Migração SQL

Criar migração nova em `supabase/` (seguir a convenção de nomenclatura das existentes):

```sql
-- Status de leitura 'Complete' vira 'Finished' (colidia visualmente com o
-- status de PUBLICAÇÃO 'Completed', que permanece inalterado).

update listas
   set valor = 'Finished'
 where categoria = 'status_leitura'
   and valor = 'Complete';

-- `atualizado_em` é tocado de propósito: o sync incremental do cliente puxa
-- por esse campo, então sem isso o Dexie local ficaria com 'Complete' órfão.
update obras
   set status_leitura = 'Finished',
       atualizado_em = now()
 where status_leitura = 'Complete';
```

Conferir se existe trigger de `atualizado_em` em `obras`. Se existir e já cuidar disso, remover a linha do `update` para não duplicar. Se não existir, manter.

### A2. Tipos e schema

- `src/types/index.ts`: `StatusLeitura` passa a `'To read' | 'Reading' | 'Finished' | 'Paused' | 'Dropped'`.
- `supabase/schema.sql`: atualizar o comentário da coluna `status_leitura`.
- `data/listas_seed.csv`: linha `status_leitura,Complete` vira `status_leitura,Finished`.

### A3. Filtros persistidos em localStorage

`FiltrosSalvos.statusLeituraFiltros` é um `Record<string, EstadoFiltro>` chaveado pelo **valor** do status. Quem tiver um filtro ativo em `Complete` salvo ficaria com um chip órfão que nunca casa.

Em `lerFiltrosSalvos()` (`src/lib/filtrosLista.ts`), remapear na leitura:

```ts
/** Status de leitura renomeado (Complete -> Finished). Remapeia filtros salvos
 * antes da renomeação, senão o chip fica órfão e nunca casa com nada. */
const STATUS_LEITURA_RENOMEADOS: Record<string, string> = { Complete: 'Finished' };
```

Aplicar ao montar `statusLeituraFiltros`: a chave lida passa por `STATUS_LEITURA_RENOMEADOS[k] ?? k`. Se as duas chaves existirem (caso improvável de estado misto), a renomeada vence.

Manter esse mapa por tempo indeterminado. É barato e cobre qualquer dispositivo que só volte a abrir o app meses depois.

### A4. Varredura final

Rodar `grep -rn "Complete" src/ data/ supabase/ scraper/ docs/` e revisar **cada** ocorrência. Cuidado: `Completed` (status de publicação) e `Complete Series` são legítimos e **não** devem ser alterados. Só o status de leitura muda.

Conferir em especial `src/lib/csvBulkUpdate.test.ts` e demais testes com fixtures que usem `status_leitura`.

---

## Bloco B: Dois filtros novos, "No cover" e "No NU link"

Dois chips novos, posicionados **logo depois do chip "Unsourced"**, com o mesmo comportamento de três estados dos existentes (`off` → `incluir` → `excluir` → `off`) e a mesma contagem no `.status-chip-contagem`.

- **No cover:** obras sem capa cadastrada. Condição: `!o.capa_url || o.capa_url.trim() === ''`.
- **No NU link:** obras sem link do Novel Updates. Condição: `!o.novelupdates_url`.

### B1. `src/lib/filtrosLista.ts`

Adicionar a `FiltrosSalvos`, a `FILTROS_PADRAO` (ambos `'off'`) e a `lerFiltrosSalvos()` (via `estadoFiltroValido`):

```ts
filtroSemCapa: EstadoFiltro;
filtroSemNu: EstadoFiltro;
```

Em `obrasFiltradasOrdenadas`, encadear na sequência existente, logo depois do `filtroUnsourced`:

```ts
.filter((o) => passaFiltro(filtros.filtroSemCapa, semCapa(o)))
.filter((o) => passaFiltro(filtros.filtroSemNu, !o.novelupdates_url))
```

Exportar o predicado de capa, porque a lista também precisa dele para a contagem:

```ts
/** Capa ausente: cobre null e string vazia (obras importadas trazem ''). */
export function semCapa(o: Obra): boolean {
  return !o.capa_url || o.capa_url.trim() === '';
}
```

**Atenção a registros locais antigos:** `novelupdates_url` foi adicionada depois do schema inicial. Registros cacheados no Dexie antes disso podem trazer `undefined`. O `!o.novelupdates_url` já cobre `undefined`, `null` e `''`, então nada extra é necessário, mas não trocar por `o.novelupdates_url === null`.

### B2. `src/pages/ListaPrincipalPage.tsx`

- Dois estados novos, inicializados de `lerFiltrosSalvos()`, no padrão dos existentes.
- Incluir ambos no objeto persistido no `useEffect` de gravação e no array de dependências.
- Duas contagens memoizadas, no padrão de `contagemUnsourced`:

```ts
const contagemSemCapa = useMemo(() => (obras ?? []).filter(semCapa).length, [obras]);
const contagemSemNu = useMemo(
  () => (obras ?? []).filter((o) => !o.novelupdates_url).length,
  [obras]
);
```

- Dois chips no JSX, imediatamente após o de Unsourced, com rótulos `No cover` e `No NU link`, classes `status-chip-sem-capa` e `status-chip-sem-nu`.
- Incluir os dois em `limparFiltros()` e em `temFiltroAtivo` (ver Bloco D1, que extrai essa lógica).

### B3. Testes

Em `src/lib/filtrosLista.test.ts`, no padrão do teste existente de `filtroUnsourced`:

- `filtroSemCapa` em `incluir` mostra só obras sem capa; em `excluir`, some com elas.
- Capa como string vazia conta como sem capa.
- `filtroSemNu` em `incluir` mostra só obras sem `novelupdates_url`.
- `novelupdates_url` `undefined` (registro legado) conta como sem link.

---

## Bloco C: Campo de busca compartilhado com autocomplete

Hoje a busca por título existe só na aba List, é um `<input>` solto, e exige digitar o suficiente para o filtro casar.

**Objetivo:** um único componente de busca, com sugestões conforme se digita, presente tanto na aba List quanto na tela da obra. É o **mesmo campo** nos dois lugares: o texto vive em `FiltrosSalvos.busca`, persistido em localStorage.

### C1. Novo componente `src/components/BuscaObras.tsx`

Seguir o padrão de dropdown já estabelecido em `VinculoObraSelect.tsx` e `TagPicker.tsx`. **Não usar `<datalist>`**: o Safari iOS não abre de forma confiável, e o projeto já abandonou essa via.

Interface:

```ts
interface Props {
  value: string;
  onChange: (texto: string) => void;
  /** Renderizado na mesma linha, à direita do campo. Usado pelo Clear filters (Bloco D). */
  acaoDireita?: ReactNode;
}
```

Comportamento:

- `input` do tipo `search`, placeholder `Search by title…` (o mesmo de hoje).
- Sugestões vêm de `db.obras` via `useLiveQuery`, filtradas por `titulo` **e** `titulos_alternativos` (mesmo critério do filtro da lista, para não haver divergência entre o que a sugestão mostra e o que a lista filtra), ordenadas por título.
- Dropdown abre no `onFocus` e no digitar. Fecha no `onBlur` com o `setTimeout(…, 120)` já usado nos outros componentes.
- Sugestão só aparece com texto digitado. Com o campo vazio, nada de dropdown: a lista inteira como sugestão não ajuda ninguém.
- **Limite de 10 sugestões.** Diferente do TagPicker (que mostra todas de propósito), aqui a base é o acervo inteiro e a lista precisa caber na tela.
- Cada sugestão mostra o título e, quando houver, o tipo entre parênteses, no formato de `VinculoObraSelect`.
- Clique numa sugestão (via `onMouseDown` com `preventDefault()`, para disparar antes do blur) **navega** para `/obra/:id` e **limpa** o texto da busca.
- `Escape` fecha o dropdown sem limpar o texto.

**Sobre limpar o texto ao selecionar:** é deliberado. Como o campo é compartilhado e persistido, se o texto ficasse, voltar para a lista depois mostraria o acervo filtrado por aquele título, o que é indesejado. A seleção substitui a intenção de filtrar. Se na prática incomodar, é uma linha para reverter.

Reaproveitar o CSS existente. As classes `.vinculo-busca-sugestoes` e suas regras já entregam exatamente o dropdown desejado; extrair para um nome neutro compartilhado (ex.: `.busca-sugestoes`) e fazer `.vinculo-busca-sugestoes` e `.tag-picker-sugestoes` referenciarem o mesmo bloco, em vez de duplicar uma terceira cópia quase idêntica das mesmas regras.

### C2. Uso na aba List

Em `ListaPrincipalPage.tsx`, substituir o `<input className="busca-topo">` atual por `<BuscaObras value={busca} onChange={setBusca} />`.

O comportamento de filtrar a lista **enquanto se digita** permanece intacto: `busca` continua alimentando `obrasFiltradasOrdenadas`. O dropdown é um atalho adicional para pular direto numa obra, não substitui o filtro.

### C3. Uso na tela da obra

Em `DetalheObraPage.tsx`, inserir o componente no topo, **abaixo** da linha de navegação `.detalhe-obra-nav` (Back / Next) e **acima** do `.detalhe-obra-form`.

Aqui não há lista para filtrar, então o campo precisa de estado próprio sincronizado com o localStorage:

```ts
const [busca, setBusca] = useState(() => lerFiltrosSalvos().busca);

function alterarBusca(texto: string) {
  setBusca(texto);
  salvarBusca(texto); // helper novo em filtrosLista.ts, ver D1
}
```

Como o React Router desmonta e remonta `ListaPrincipalPage` na troca de rota, e essa página inicializa o estado a partir de `lerFiltrosSalvos()` no initializer do `useState`, voltar para a lista já reflete o texto digitado aqui. Confirmar esse comportamento no teste manual.

---

## Bloco D: Clear filters na tela da obra

Na tela da obra, **na mesma linha do campo de busca, logo depois dele**, um botão `Clear filters`. Só aparece quando há algum filtro ativo. Sem filtro ativo, o botão não é renderizado (não é `disabled`, é ausente).

### D1. Extrair a lógica compartilhada para `filtrosLista.ts`

Hoje `temFiltroAtivo` e `limparFiltros` estão inline em `ListaPrincipalPage`. Duas telas precisam deles agora. Extrair:

```ts
export function temFiltroAtivo(f: FiltrosSalvos): boolean {
  return (
    !!f.busca ||
    !!f.tipo ||
    Object.values(f.statusLeituraFiltros).some((v) => v !== 'off') ||
    !!f.statusPublicacao ||
    f.generosSel.length > 0 ||
    f.tagsSel.length > 0 ||
    f.filtroNovoCapitulo !== 'off' ||
    f.filtroNovel !== 'off' ||
    f.filtroUnsourced !== 'off' ||
    f.filtroSemCapa !== 'off' ||
    f.filtroSemNu !== 'off'
  );
}

export function salvarFiltros(f: FiltrosSalvos): void {
  localStorage.setItem(FILTROS_KEY, JSON.stringify(f));
}

/** Grava só a busca, preservando o resto (usado pela tela da obra, que não
 * mantém os demais filtros em estado). */
export function salvarBusca(texto: string): void {
  salvarFiltros({ ...lerFiltrosSalvos(), busca: texto });
}

export function limparFiltrosSalvos(): void {
  salvarFiltros(FILTROS_PADRAO);
}
```

`ListaPrincipalPage` passa a usar `temFiltroAtivo(...)` e `salvarFiltros(...)` no lugar da lógica inline, mantendo o `limparFiltros()` local que reseta os estados React **e** chamando `limparFiltrosSalvos()`.

Manter os dois filtros do Bloco B na função. Adicionar campo novo em `FiltrosSalvos` sem tocar em `temFiltroAtivo` é o erro mais provável deste lote: o botão Clear filters some silenciosamente para aquele filtro.

### D2. Na tela da obra

```tsx
<BuscaObras
  value={busca}
  onChange={alterarBusca}
  acaoDireita={
    filtroAtivo ? (
      <button type="button" className="filtros-limpar" onClick={handleLimparFiltros}>
        Clear filters
      </button>
    ) : null
  }
/>
```

Onde `filtroAtivo` é derivado de `lerFiltrosSalvos()`, recalculado quando `busca` muda (a busca é o único filtro que essa tela altera), e `handleLimparFiltros` chama `limparFiltrosSalvos()` e zera o `busca` local.

### D3. CSS

`.busca-topo` hoje é `width: 100%` com `margin-bottom: 14px`. Com uma ação ao lado, vira container flex:

```css
.busca-linha {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}

.busca-linha .busca-topo {
  flex: 1;
  min-width: 0;
  margin-bottom: 0;
}
```

O wrapper de posicionamento do dropdown (`position: relative`) precisa envolver **só o input**, não a linha inteira, senão as sugestões se estendem por baixo do botão. Estruturar como: `.busca-linha` > (`.busca-input-wrap` com `position: relative` + input + `ul` de sugestões) + `acaoDireita`.

Testar em viewport de ~390px: o botão `Clear filters` não pode espremer o input a ponto de inutilizá-lo. Se apertar, permitir quebra de linha na `.busca-linha` com `flex-wrap: wrap` e `flex-basis: 100%` no input abaixo de 400px.

---

## Bloco E: Novo favicon a partir de PNG

O pipeline atual parte de `scripts/icon-source.svg`, renderizado por Playwright para PNGs em `public/icons/`. O favicon do navegador é `public/favicon.svg`, declarado em `includeAssets` no `vite.config.ts`.

A arte nova (gatinho em traço branco sobre fundo preto) vem como **PNG de 1024×1024**, entregue como `scripts/icon-source.png`. Adaptar o pipeline sem adicionar dependência: continuar usando o Playwright já instalado, trocando o SVG inline por um `<img>` com o PNG em base64.

**Arquivo já validado, não repetir a checagem:** 1024×1024, PNG RGBA com alfa integralmente opaco (255 em todo o canvas), fundo `#000000` nos quatro cantos. A arte ocupa 74,5% do lado, com raio máximo de 382px contra os 410px do limite maskable: **zero pixels fora da zona segura**. Legibilidade conferida em 32px. Nada a ajustar na arte.

Ponto de atenção estético (não bloqueia): o fundo do ícone é preto puro, enquanto o `background_color` do manifest é `#16171d`. Na splash screen do PWA isso produz um quadrado ligeiramente mais escuro que o fundo. Se a dona pedir para casar, trocar o fundo do PNG para `#16171d` e regerar. Não alterar por conta própria.

### E1. `scripts/generate-icons.mjs`

Substituir a leitura do SVG por:

```js
const png = readFileSync(path.join(__dirname, 'icon-source.png')).toString('base64');
const dataUri = `data:image/png;base64,${png}`;
```

E o `setContent` por um documento que preenche exatamente o viewport:

```js
await page.setContent(
  `<html><body style="margin:0;padding:0;">
     <img src="${dataUri}" style="display:block;width:${size}px;height:${size}px;">
   </body></html>`
);
```

Remover o `page.evaluate` que ajustava `width`/`height` do `<svg>`, que deixa de fazer sentido.

Ampliar a lista de tamanhos para incluir o favicon:

```js
const sizes = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'maskable-icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'favicon-32.png', size: 32, outDir: publicDir },
];
```

O favicon vai para `public/` (não `public/icons/`), então o loop precisa aceitar um diretório de saída por item, com `outDir` default apontando para `public/icons`.

O `executablePath` do chromium está hardcoded no script atual. Manter como está se ainda resolver na máquina; se não, trocar por `chromium.launch()` sem argumento.

### E2. `vite.config.ts`

- `includeAssets: ['favicon.svg']` passa a `['favicon-32.png']`.
- Os três ícones do manifest continuam apontando para `icons/*.png`, sem alteração de caminho.

### E3. `index.html`

Trocar o `<link rel="icon">` para apontar a `favicon-32.png` com `type="image/png"`. Conferir se o `href` respeita o `base` do Vite (`/manga-lists/` em produção); usar caminho relativo, como o restante do arquivo já faz.

### E4. Arquivos antigos

Remover `public/favicon.svg` e `scripts/icon-source.svg` **só depois** de confirmar que o build gera todos os ícones novos e que o app instala corretamente. Manter os antigos em paralelo durante a verificação.

### E5. Verificação

- `npm run build` gera os cinco arquivos nos lugares certos.
- Abrir o `dist/` servido localmente e conferir o ícone na aba do navegador.
- No DevTools, aba Application > Manifest: nenhum erro de ícone, e o preview do maskable não corta a arte.
- No iOS, adicionar à tela de início e conferir o ícone (usa o `apple-touch-icon`).

**Nota registrada:** o favicon e os ícones do manifest vivem no repositório, em `public/`, e não no Supabase Storage. O Workbox pré-cacheia os PNGs do build (offline), e os ícones do manifest precisam ser same-origin para o prompt de instalação funcionar de forma confiável. O bucket `icons` do Supabase continua servindo apenas a aba Tests, que é outro caso de uso e não muda.

---

## Checklist de verificação

- [ ] `npm run build`, `npm run lint` e os testes passam
- [ ] Migração SQL renomeia o valor em `listas` e em `obras`, tocando `atualizado_em`
- [ ] `StatusLeitura`, `schema.sql` e `listas_seed.csv` atualizados para `Finished`
- [ ] `grep -rn "Complete"` revisado item a item; `Completed` (publicação) intacto
- [ ] Filtro salvo em `Complete` é remapeado para `Finished` na leitura, sem chip órfão
- [ ] Obras que estavam em `Complete` aparecem em `Finished` no app após o sync, sem perder status
- [ ] Chips `No cover` e `No NU link` aparecem logo após `Unsourced`, com contagem correta
- [ ] Os dois chips ciclam nos três estados e o estado sobrevive a sair e voltar da tela
- [ ] Capa como string vazia conta como "sem capa"; `novelupdates_url` `undefined` conta como "sem link"
- [ ] Testes novos em `filtrosLista.test.ts` cobrem os quatro casos do Bloco B3
- [ ] `BuscaObras` usado na aba List e na tela da obra, com o mesmo texto persistido entre as duas
- [ ] Sugestões casam por título **e** títulos alternativos, limitadas a 10, só com texto digitado
- [ ] Clicar numa sugestão navega para a obra e limpa o texto
- [ ] Digitar na lista continua filtrando ao vivo, sem depender de selecionar sugestão
- [ ] Dropdown abre e é clicável no Safari iOS (o `onMouseDown` com `preventDefault` é o ponto crítico)
- [ ] `Clear filters` aparece na mesma linha da busca na tela da obra, só com filtro ativo, e some quando não há
- [ ] `temFiltroAtivo` cobre os onze filtros, incluindo os dois novos
- [ ] Limpar filtros na tela da obra reflete ao voltar para a lista
- [ ] Dropdown de sugestões não passa por baixo do botão `Clear filters`
- [ ] CSS do dropdown compartilhado entre busca, vínculo e TagPicker, sem terceira cópia das regras
- [ ] Pipeline de ícones gera os cinco arquivos a partir do PNG 1024×1024
- [ ] `includeAssets` e `index.html` apontando para `favicon-32.png`
- [ ] Manifest sem erro no DevTools; maskable sem corte; ícone correto na aba e no iOS
- [ ] Testado em viewport de ~390px: busca, botão e chips sem sobreposição nem estouro
