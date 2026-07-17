# Handout 1 de 2 (executar com Sonnet): correções de UI, código e scraper

Repositório: `blair-boo/manga-lists` (PWA Ratsnest: Vite + React + TS, Dexie, Supabase, scrapers Python em GitHub Actions).

Este é o primeiro de dois handouts. Ele contém os itens mais prescritivos. Um segundo handout (executado depois, por outro modelo) fará a revisão deste trabalho e implementará os itens que exigem mais julgamento: reconciliação de deletes no sync (B1), ações em massa na fila (A5), diálogos próprios (E2), testes (B5) e divisão do CSS (D1). NÃO implemente esses cinco itens aqui, mesmo que pareçam relacionados.

Item explicitamente FORA de escopo permanente: o texto "site: titulo-no-site" nos cards da fila de aprovação (função `tituloNoSite`) fica exatamente como está. É usado para conferência manual. Não remover, não condicionar.

Ordem de execução: A3 primeiro (os demais dependem do helper de erro), depois o restante na ordem listada. Cada item é independente; se algum não puder ser concluído, registre o motivo e siga para o próximo.

---

## A3. Erros exibidos como "[object Object]" (fazer primeiro)

Causa: o padrão `err instanceof Error ? err.message : String(err)` está copiado em vários componentes. Erros do Supabase (`FunctionsHttpError`, `PostgrestError` em formato plain object) caem no `String(err)` e viram `[object Object]`.

Criar `src/lib/erros.ts`:

```ts
/** Extrai uma mensagem legível de qualquer formato de erro (Error, PostgrestError, FunctionsHttpError, objeto plano, string). */
export function mensagemDeErro(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    for (const chave of ['message', 'error_description', 'error', 'details', 'hint']) {
      const v = o[chave];
      if (typeof v === 'string' && v.trim()) return v;
    }
    try {
      return JSON.stringify(err);
    } catch {
      /* segue pro fallback */
    }
  }
  return String(err);
}
```

Substituir TODAS as ocorrências do padrão `err instanceof Error ? err.message : String(err)` (e variações que exibem erro cru) por `mensagemDeErro(err)`. Pontos conhecidos (buscar por outros com grep):

- `src/components/AprovacaoDominios.tsx` (2 ocorrências)
- `src/components/FilaAprovacoes.tsx`
- `src/components/DominiosSemAdaptador.tsx`
- `src/pages/AtualizacoesPage.tsx` (`mensagemErroAcao`, `AdicionarDominioManual`, `handleDownload`)
- `src/components/Layout.tsx` (`title={String(lastError)}` no indicador de sync error)
- `src/sync/SyncContext.tsx` se armazenar erro exibível

## A1. URL quebrando caractere por caractere nos cards de aprovação (crítico)

Sintoma: no mobile, a URL da fonte em `FilaAprovacoes` renderiza um ou dois caracteres por linha (`http` / `s://m` / `agust` ...), deixando cada card com centenas de pixels de altura.

Causa: `.fonte-link` em `src/index.css` usa `word-break: break-all` dentro de um flex container que encolhe.

Correção em `src/index.css`:

```css
.fonte-link {
  color: var(--accent);
  font-size: 12px;
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

(remover o `word-break: break-all`)

E em `src/components/FilaAprovacoes.tsx`, adicionar `title={f.url}` no `<a className="fonte-link">` para a URL completa continuar visível no hover/long-press.

Verificar que `.fonte-aprovacao-info` mantém `flex: 1; min-width: 0;` (já existe) e que o `<li class="fonte-item">` não impede o truncamento (se necessário, adicionar `min-width: 0` nos filhos flex relevantes).

## A2. Card de aprovação sobreposto no mobile

Sintoma: o select "Type?" e os botões Approve/Reject/Blacklist colidem com o nome da fonte em telas estreitas.

Correção: dentro do media query `@media (max-width: 640px)` existente em `src/index.css`, adicionar:

```css
.fonte-aprovacao {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.fonte-aprovacao .fonte-tipo-select {
  align-self: flex-start;
}

.fonte-aprovacao .fonte-acoes {
  margin-left: 0;
  flex-wrap: wrap;
}
```

Resultado esperado no mobile: linha 1 = info (nome + URL truncada + detected ch.), linha 2 = select de tipo, linha 3 = botões de ação. No desktop, o layout atual em linha permanece.

## A4. Botões de aprovação sem estado de processamento (FilaAprovacoes)

Sintoma: Approve/Reject/Blacklist em `FilaAprovacoes.tsx` não desabilitam durante a ação; dá para clicar duas vezes e disparar mutações duplicadas.

Correção: seguir o mesmo padrão já usado em `AprovacaoDominios.tsx`:

- estado `const [processando, setProcessando] = useState<string | null>(null)` (id da fonte em processamento)
- envolver as ações (`setFonteAprovacao`, `handleBlacklist`, e o `onChange` do select de tipo) em try/finally setando `processando`
- `disabled={processando === f.id}` nos três botões e no select; o botão da ação em andamento mostra `Please wait…`
- erros capturados exibem `mensagemDeErro(err)` num `<p className="execucao-status execucao-erro">` dentro do corpo da fila

## A7. Contagem nos chips de filtro da fila

Nos chips Pending / Approved / Rejected / Blacklist de `FilaAprovacoes.tsx`, exibir a contagem de itens do escopo atual, no mesmo estilo do `.status-chip-contagem` da lista principal (reutilizar a classe se fizer sentido, ou criar `.fila-filtro-contagem` equivalente).

- Pending/Approved/Rejected: contar `fontes` filtradas por `pertence(f)` e pelo status correspondente (memoizar um `Map<StatusAprovacao, number>` em vez de três filters separados).
- Blacklist: `blacklist.length` (só quando `comBlacklist`; o valor já é carregado quando a fila está aberta).

## B2. recalcUltimoCapituloLancado grava mesmo sem mudança

Em `src/db/repo.ts`, `recalcUltimoCapituloLancado` chama `updateObra` incondicionalmente, o que enfileira mutação, altera `atualizado_em` e dispara sync a cada edição de fonte, mesmo quando nada mudou.

Correção: carregar a obra antes e só chamar `updateObra` se `ultimo_capitulo_lancado` ou `ultimo_capitulo_via_scraper` calculados diferirem dos valores atuais.

## B3. Hook useAsyncAction para eliminar o padrão repetido de carregando/erro

Criar `src/hooks/useAsyncAction.ts`:

```ts
import { useCallback, useState } from 'react';
import { mensagemDeErro } from '../lib/erros';

/** Encapsula o padrão executando/erro de ações assíncronas disparadas pela UI. */
export function useAsyncAction<Args extends unknown[]>(fn: (...args: Args) => Promise<void>) {
  const [executando, setExecutando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const executar = useCallback(
    async (...args: Args) => {
      setExecutando(true);
      setErro(null);
      try {
        await fn(...args);
      } catch (err) {
        setErro(mensagemDeErro(err));
      } finally {
        setExecutando(false);
      }
    },
    [fn]
  );

  return { executar, executando, erro, limparErro: () => setErro(null) };
}
```

Refatorar para usá-lo (sem mudar comportamento visível): `AprovacaoDominios`, `AdicionarDominioManual`, `DominiosSemAdaptador` (ação de detectar), as seções de scraper em `AtualizacoesPage` (`handleAcao`), e o A4 onde couber. Componentes com necessidades além do padrão podem manter estado próprio.

## B4. Dedupe de título usando o índice do Dexie

Em `criarObraComFontes` (`src/db/repo.ts`), substituir `db.obras.toArray()` + find em memória por:

```ts
const existente = await db.obras.where('titulo').equalsIgnoreCase(obra.titulo.trim()).first();
```

O índice `titulo` já existe no schema do Dexie. Manter o comportamento atual (retorna a existente com `jaExistia: true`).

## C1. update_obras refaz fetch de obras e fontes por site

Em `scraper/update_obras.py`, `obras_sem_fonte_no_site` busca as tabelas `obras` e `fontes` completas a cada site processado. Carregar ambas uma única vez no `main()` e passar as listas como parâmetro, filtrando em memória por site. Comportamento idêntico, N vezes menos queries.

## C2. Retry com backoff no http_get

Em `scraper/common.py` (`http_get`): em `requests.RequestException` de rede (timeout, connection error) ou resposta 5xx, fazer 1 retry após 2 segundos antes de propagar. NÃO fazer retry em 403/503 com cara de Cloudflare (isso já tem o caminho do curl fallback em `adapter_base.fetch_http` e retry só queimaria reputação de IP). Manter o comportamento atual em todos os outros casos.

## C3. Resumo estruturado das runs

Objetivo: a UI de Updates mostrar contadores (encontradas/atualizadas/falhas) sem parsear a string de `mensagem`.

1. Migração SQL (novo arquivo em `supabase/`, para rodar manualmente no SQL Editor, seguindo o padrão do projeto):
   ```sql
   alter table scraper_runs add column if not exists resumo jsonb;
   ```
2. `finalizar_run` em `scraper/common.py` ganha parâmetro opcional `resumo: dict | None = None`, gravado na coluna quando presente. Chamadas existentes continuam válidas.
3. Preencher o resumo nos três estágios com o que já é contado hoje:
   - `update_fontes.py`: `{"verificadas": n, "atualizadas": n, "falhas": n}`
   - `update_obras.py`: `{"fontes_novas": n}`
   - `discover_fontes.py`: `{"fontes_novas": n}`
4. Frontend: adicionar `resumo` ao tipo `ScraperRun` em `src/types` e, em `StatusExecucaoScraper.tsx`, exibir os pares chave/valor do resumo quando existir (formato compacto: `verificadas 120 · atualizadas 8 · falhas 2`), mantendo `mensagem` como está.

## D2. Extrair componentes de AtualizacoesPage.tsx

Mover para arquivos próprios em `src/components/`, sem mudança de comportamento:

- `AdicionarDominioManual` -> `src/components/AdicionarDominioManual.tsx`
- A seção "Bulk fill via CSV" (upload + download + resultado) -> `src/components/CsvBulkSection.tsx`

`mensagemErroAcao` pode ir junto para `src/lib/erros.ts` (ou permanecer onde for usada, desde que única).

## D3. Versionar os handouts em docs/

Criar `docs/` na raiz do repo (se ainda não existir) e garantir que os handouts referenciados nos comentários do código (HANDOUT_ARQUITETURA_SCRAPERS, handout consolidado dos blocos B/C, HANDOUT_SCRAPERS_NOVELSHUB_TS_MADARA) estejam commitados lá. Incluir este handout como `docs/HANDOUT_1_SONNET.md`. Se algum handout citado não existir como arquivo no repo, criar um placeholder `docs/HANDOUTS_FALTANDO.md` listando os nomes, para eu repor depois (não inventar conteúdo).

## E1. Centralizar o nome do app

O nome do app ainda pode mudar (renomeação em avaliação). Centralizar as referências:

1. Criar `src/config.ts` com `export const APP_NAME = 'Ratsnest';`
2. Usar `APP_NAME` em `Layout.tsx` (título do header) e em qualquer outro texto de UI que cite o nome.
3. Em `vite.config.ts`, extrair `const APP_NAME = 'Ratsnest'` no topo do arquivo e usar nas propriedades `name`/`short_name` do manifest (o config não importa código de `src`, então a constante é duplicada de propósito; deixar comentário apontando para `src/config.ts`).
4. Em `index.html`, deixar comentário `<!-- nome do app: manter em sincronia com src/config.ts -->` acima do `<title>`.

Não renomear nada agora; apenas reduzir a renomeação futura a 3 pontos conhecidos.

---

## Checklist de verificação deste handout

- [ ] `npm run build` e `npm run lint` passam
- [ ] Card de aprovação no viewport de 390px: URL em 1 linha com ellipsis, nada sobreposto, botões clicáveis
- [ ] Nenhum `String(err)` exibindo erro cru na UI; nenhuma ocorrência restante do padrão antigo (grep por `instanceof Error ?`)
- [ ] Editar o capítulo de uma fonte sem mudar o valor NÃO gera mutação na syncQueue (B2)
- [ ] O texto "site: titulo-no-site" dos cards de aprovação continua presente
- [ ] Nenhum dos itens reservados ao segundo handout foi implementado (B1, A5, E2, B5, D1)
