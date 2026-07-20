# Diagnóstico do sync (base para um handout de robustez)

Repositório: `blair-boo/manga-lists` (PWA Ratsnest). Este documento descreve a
arquitetura de sincronização atual, a classe de bug "edições somem", o que já
foi corrigido, e o que falta endurecer. Serve de base para gerar um handout
dedicado a robustez do sync. Todas as referências apontam para o código real.

---

## 1. Como o sync funciona hoje

Local-first: a UI lê/escreve no IndexedDB (Dexie) e nunca fala direto com o
Supabase a partir dos componentes. Toda escrita passa por `src/db/repo.ts`
(`updateObra`/`updateFonte`/`createObra`/`createFonte`), que:

1. grava no Dexie;
2. enfileira uma mutação na tabela `syncQueue` (`enqueueMutation`);
3. dispara `syncNow()` em background (`triggerBackgroundSync`).

O ciclo de sync (`src/sync/sync.ts`, `syncNow`) é serializado por um flag
`syncing` (um sync por vez por aba) e roda, em ordem:

```
pushPending()            // envia a syncQueue pro servidor (upsert/delete)
pullObras()              // pull incremental de obras (por atualizado_em)
reconciliarObrasDeletadas()  // remove local o que sumiu do servidor (com guarda)
pullFontes()             // full refresh: clear() + bulkPut
pullListas()             // full refresh: clear() + bulkPut
```

Detalhes relevantes:

- **push** (`pushPending`, linhas ~24-37): itera a fila por `createdAt`, faz
  `upsert` (insert/update) ou `delete`. Para no primeiro erro (`break`) e deixa
  o resto na fila pra próxima rodada. Sem retry/backoff próprio — a próxima
  tentativa depende do próximo `triggerBackgroundSync` ou do intervalo periódico.
- **pullObras** (linhas ~40-61): incremental. Busca `obras` com
  `atualizado_em > lastSyncedAt('obras')`, aplica `bulkPut`, e avança o
  watermark. **Agora com guarda** (ver seção 3).
- **pullFontes** (linhas ~104-110): `fontes` não tem coluna de atualização (o
  scraper escreve `ultimo_capitulo_detectado` in-place sem mexer em `criado_em`),
  então não dá pra pull incremental — faz **full refresh**: `db.fontes.clear()`
  seguido de `bulkPut` de tudo do servidor.
- **pullListas** (linhas ~112-117): mesmo full refresh das listas.
- `atualizado_em` de obras é setado no cliente (`new Date().toISOString()` em
  `updateObra`), não pelo servidor.

---

## 2. A classe de bug: "edições somem"

### Sintoma
Uma edição que a usuária acabou de fazer (autosave, ou qualquer `updateObra`)
reaparece com o valor antigo, como se tivesse sido descartada.

### Causa raiz
`pull*` sobrescreve o estado local com o do servidor **sem checar se há uma
mutação local pendente ainda não enviada**. Se um pull roda na janela entre "a
usuária editou (local + fila)" e "o push dessa edição completou", o pull traz a
versão antiga do servidor e engole a edição local.

Cenários que abrem essa janela:
- **push lento ou offline**: a edição fica na fila; um pull no meio traz o valor
  velho. É o cenário mais provável no uso real (iOS/PWA, conexão instável).
- **pull inicial `since=null`** (primeiro sync após abrir o app) correndo com uma
  edição feita logo de cara.
- **outro dispositivo** tocando a mesma obra e empurrando um `atualizado_em` mais
  novo que o watermark local, enquanto a edição local ainda não subiu.

### Prova determinística
Foi reproduzido com Playwright interceptando as chamadas ao Supabase: bloqueia o
POST/PATCH de `obras` (simula push offline), edita local (autosave grava +
enfileira), e injeta uma resposta de pull trazendo a obra com o **título antigo**
e `atualizado_em` no futuro (força o pull incremental a trazê-la). Sem guarda, o
`bulkPut` clobbera o local e a edição some. Com a guarda (seção 3), a edição
sobrevive. O teste isolado passa de forma determinística; a fragilidade que
aparecia rodando a suíte inteira era só timing de harness, não do código.

---

## 3. O que já foi corrigido (pullObras)

`pullObras` ganhou a mesma guarda que a `reconciliarObrasDeletadas` já usava para
deletes: antes do `bulkPut`, exclui as linhas que têm mutação insert/update
pendente na `syncQueue`.

```ts
const pendentes = await db.syncQueue.where('entity').equals('obras').toArray();
const protegidos = new Set(pendentes.filter((m) => m.op !== 'delete').map((m) => m.recordId));
const aAplicar = rows.filter((r) => !protegidos.has(r.id));
if (aAplicar.length > 0) await db.obras.bulkPut(aAplicar);
// watermark avança pelo maior atualizado_em de TODAS as linhas (inclusive as
// puladas), pra não re-buscá-las em loop; a protegida reconcilia quando o push passar.
await setLastSyncedAt('obras', rows[rows.length - 1].atualizado_em);
```

Racional: a edição local é a fonte da verdade até o push confirmá-la no servidor.
O push envia a versão local; o pull seguinte a traz de volta com o timestamp novo,
já consistente. Sem perda.

Validado ao vivo (390px, conta de teste) com o cenário de push bloqueado + pull
injetado. Build/lint/testes passam.

---

## 4. O que falta endurecer (escopo do handout de robustez)

### 4.1. pullFontes é destrutivo (prioridade alta)
`pullFontes` faz `clear() + bulkPut` — apaga TODAS as fontes locais e recria do
servidor. Isso é pior que o caso das obras: uma fonte recém-criada localmente
(ainda não sincronizada) ou uma edição pendente de `ordem` (reordenação — recém
adicionada) ou de `ultimo_capitulo_detectado` some/reverte por um instante, e
some de vez se o push falhar. A guarda de filtro não basta aqui porque o `clear()`
apaga tudo; o correto é trocar por uma **reconciliação** no mesmo shape da
`reconciliarObrasDeletadas`:

- aplicar (`bulkPut`) as linhas do servidor **exceto** as fontes com mutação
  pendente na fila;
- remover localmente só as fontes que **não estão** no servidor **e não têm**
  mutação pendente;
- nunca `clear()` cego.

Observação estrutural: `fontes` não tem `atualizado_em`, o que força o full
refresh. Um handout de robustez pode avaliar **adicionar `updated_at` a `fontes`**
(trigger no Postgres) para permitir pull incremental e evitar o refresh total —
melhora custo e reduz a janela de corrida. O scraper precisaria tocar essa coluna
ao gravar capítulo (ou um trigger `before update` cuidar disso).

### 4.2. pullListas (prioridade baixa)
Mesmo `clear() + bulkPut`. `listas` (categorias/opções) raramente é editada
localmente pela usuária, então o risco é menor, mas por consistência vale a mesma
reconciliação, ou ao menos documentar por que é aceitável manter o refresh.

### 4.3. Last-write-wins por timestamp (defesa em profundidade)
A guarda da fila cobre o caso "tenho edição pendente". Não cobre "a fila já
drenou mas um pull trouxe uma cópia velha por clock skew / ordenação". Somar uma
regra de merge: só sobrescrever a obra local se
`server.atualizado_em > local.atualizado_em`. Como a edição local carrega um
`atualizado_em` mais novo, o servidor mais velho nunca a engole. Cuidado com
clock skew (o `atualizado_em` é gerado no cliente hoje — ver 4.5).

### 4.4. Coalescing de sync e retry de push
- `triggerBackgroundSync` dispara `syncNow` a cada mutação, mas o flag `syncing`
  faz as chamadas concorrentes retornarem cedo (`already-syncing`). Resultado: as
  mutações enfileiradas durante um sync em andamento só sobem no **próximo** sync.
  Não é bug, mas aumenta a janela de corrida. Avaliar um "sync sujo" que
  re-executa o ciclo se novas mutações entraram durante a rodada.
- `pushPending` para no primeiro erro e não reagenda sozinho — depende do próximo
  trigger/intervalo. Avaliar retry com backoff e um disparo ao voltar a rede
  (`online` event já existe no `SyncContext`, confirmar cobertura).

### 4.5. Origem do `atualizado_em`
Hoje o cliente gera `atualizado_em`. Para reconciliação por timestamp confiável
(4.3), considerar o servidor como fonte da verdade do timestamp (trigger
`updated_at` no Postgres) e o cliente usar um relógio lógico/local só para
ordenar a própria fila. Decisão de projeto — listar trade-offs no handout.

### 4.6. Watermark ao pular linhas protegidas
Detalhe já tratado no fix de obras, mas vale registrar como invariante para o
handout: ao pular uma linha protegida no `bulkPut`, o watermark ainda avança pelo
maior `atualizado_em` do lote. Isso evita re-buscar em loop. A linha protegida se
reconcilia quando seu push sobe (o servidor ganha timestamp novo) e o pull
seguinte a traz. Se o push **nunca** subir (offline permanente), o local
prevalece — que é o comportamento desejado (não perder edição). Garantir que essa
invariante seja mantida em qualquer refatoração.

---

## 5. Estratégia de teste sugerida para o handout

O approach que funcionou para provar o bug e o fix, de forma determinística, sem
depender de timing:

- Playwright + interceptação das rotas do Supabase (`page.route`), roteando o
  tráfego real via um `APIRequestContext` do Node (o Chromium do sandbox não fala
  com o MITM da proxy; o Node com a CA fala).
- Flags no interceptador para (a) **bloquear push** (abortar POST/PATCH da
  entidade) e (b) **injetar um pull** com a versão antiga + `atualizado_em` no
  futuro.
- Ler o IndexedDB direto (`indexedDB.open('manga-lists')`) para asserções sobre o
  estado local e a `syncQueue`, com poll em Node (evita flake de microtiming).
- Rodar contra seed descartável (prefixo `ZZ`), resetando o servidor via SQL
  entre execuções, e limpar tudo no fim.

Cenários que o handout deve cobrir com teste:
1. Edição offline (push bloqueado) + pull trazendo versão velha → edição
   sobrevive (obras: já coberto; fontes: a implementar).
2. Fonte criada localmente offline + pullFontes → fonte sobrevive.
3. Reordenação de fontes (edição de `ordem`) offline + pullFontes → ordem
   sobrevive.
4. Push volta a funcionar → edição chega ao servidor e a fila drena.
5. Duas edições concorrentes (dois dispositivos) → sem perda silenciosa
   (last-write-wins previsível, ou merge documentado).

---

## 6. Resumo priorizado

1. **pullFontes: trocar clear()+bulkPut por reconciliação com guarda** (alta —
   mexe justamente no que o handout de UI/vínculo acabou de adicionar: `ordem`).
2. **Last-write-wins por timestamp** em pullObras/pullFontes (média — defesa em
   profundidade).
3. **Avaliar `updated_at` em `fontes`** para pull incremental (média — melhora
   custo e reduz janela de corrida; envolve schema + scraper).
4. **Coalescing/retry de sync** (média-baixa — reduz janela e melhora offline).
5. **pullListas: reconciliação ou justificativa** (baixa).
6. **Origem do `atualizado_em` no servidor** (baixa-estrutural — pré-requisito
   para um LWW realmente confiável).

Já feito nesta rodada: guarda do `pullObras` (item equivalente ao 1, mas para
obras), validada ao vivo.
