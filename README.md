# Minha Lista — controle de leitura de mangás/manwhas/manhuas/novels

PWA local-first (funciona offline, instalável no celular/PC) pra substituir a
planilha de controle de leitura, com sincronização na nuvem via Supabase e um
scraper agendado que atualiza o progresso das obras automaticamente.

## Stack

- Frontend: Vite + React + TypeScript
- PWA: `vite-plugin-pwa` (Workbox)
- Cache offline local: Dexie.js (IndexedDB)
- Sync / banco: Supabase (Postgres + Auth)
- Hospedagem: GitHub Pages
- Scraper agendado: GitHub Actions (cron diário) + Python

## 1. Criar o projeto no Supabase

1. Crie uma conta/projeto em [supabase.com](https://supabase.com).
2. Em **SQL Editor**, rode nesta ordem:
   - `supabase/schema.sql` — cria as tabelas e RLS.
   - `supabase/storage.sql` — cria o bucket público `capas`.
3. Em **Authentication → Providers**, deixe só e-mail/senha habilitado e
   **desative "Enable email signups"** (ou equivalente) — o app não tem tela
   de cadastro; a conta é criada manualmente pelo painel, já que é uso
   pessoal e a chave `anon` fica pública no bundle do GitHub Pages.
4. Em **Authentication → Users**, clique em "Add user" e crie seu próprio
   usuário (e-mail + senha) — é com ele que você faz login no app.
5. Em **Project Settings → API**, anote:
   - **Project URL**
   - **anon public key**
   - **service_role key** (secreta — nunca vai pro app, só nos scripts locais e no scraper)

## 2. Rodar localmente

```bash
npm install
cp .env.example .env.local
# edite .env.local com sua Project URL e anon key
npm run dev
```

Acesse `http://localhost:5173`, faça login com o usuário criado no passo 1.4.

## 3. Importar os dados da planilha (uma vez só)

```bash
cp scripts/.env.example scripts/.env
# edite scripts/.env com SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY
node scripts/import-data.mjs
```

Isso importa `data/listas_seed.csv`, `data/obras_import.csv` e
`data/fontes_import.csv` pro banco. É idempotente: rodar de novo não duplica
títulos nem fontes já existentes.

## 4. Migrar as capas do Google Drive (uma vez só, opcional)

Sincronize/baixe localmente a pasta do Drive com as capas (arquivos nomeados
como slug do título, ex: `why-are-you-obsessed-with-your-fake-wife.jpg`), depois:

```bash
pip install -r scripts/requirements.txt
python scripts/migrate_capas.py /caminho/para/a/pasta/do/drive
```

Capas sem correspondência ficam listadas em `capas_sem_match.csv` na raiz do
repo (não versionado) pra revisão manual. Depois dessa migração pontual,
novos títulos podem ter a capa preenchida direto no formulário do app (URL)
ou, no futuro, upload direto.

## 5. Publicar no GitHub Pages

1. Em **Settings → Pages**, defina "Source" como **GitHub Actions**.
2. Em **Settings → Secrets and variables → Actions**, crie:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_URL` (mesmo valor de `VITE_SUPABASE_URL`, usado pelo scraper)
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Dê push na branch `main` — o workflow `.github/workflows/deploy.yml` builda
   e publica automaticamente em `https://<seu-usuario>.github.io/manga-lists/`.

Se o nome do repositório for diferente de `manga-lists`, ajuste a constante
`BASE_PATH` em `vite.config.ts`.

## 6. Scraper agendado

`.github/workflows/scraper.yml` roda todo dia às 12:00 UTC (ajustável no
`cron`), em duas etapas (`scraper/update_fontes.py` e
`scraper/discover_fontes.py`):

1. Atualiza `ultimo_capitulo_detectado` de cada fonte já aprovada e recalcula
   `obras.ultimo_capitulo_lancado`.
2. Procura fontes novas (nos sites de `sites_suportados` e, se não achar, via
   busca web) e insere como `pendente` — aparecem na tela "Fontes pendentes"
   do app pra você aprovar ou rejeitar.

Também dá pra disparar manualmente em **Actions → Scraper de capítulos → Run workflow**.

**Novel Updates (`scraper/novelupdates.py`):** casa cada obra com sua página no
novelupdates.com pra guardar o link canônico e enriquecer os Alternative titles.
O fetch é por Chromium real via Playwright (`scraper/nu_browser.py`); o slug do NU
é derivado do título e a página `/series/<slug>/` é aberta direto (o endpoint de
busca `?s=` responde 403 a IPs de datacenter). Disparo manual pela aba Updates
("Find on Novel Updates") ou em **Actions → Scraper - Novel Updates**; input
opcional `limite` (env `NU_LIMITE_OBRAS`) pra rodar em lotes.

> **Limitação de acesso conhecida:** o Cloudflare do NU serve só a **primeira**
> requisição de cada sessão e depois passa a devolver o managed challenge "Just a
> moment" (403) que o Chromium headless **não resolve** a partir do IP do GitHub
> Actions (nem do IP de datacenter em geral) — comprovado pela sonda
> `scraper/probe_novelupdates.py` (1/6 páginas passam). Ou seja, o scraper em
> massa **não funciona** a partir do CI: ele aborta cedo e reporta "Cloudflare
> bloqueou o acesso automático". Para vincular no CI seria preciso um proxy
> residencial ou uma API de scraping gerenciada (chave via secret). Enquanto isso,
> o vínculo funciona **manualmente**: o botão "+" no campo Novel Updates da página
> da obra aceita colar a URL do NU à mão (do seu próprio navegador o Cloudflare não
> bloqueia), e a fila de aprovação/espelhamento continua valendo.

**Nota sobre o scraper:** a extração de número de capítulo é feita por uma
heurística genérica (padrões tipo `chapter-123` em links/texto), já que não
foi possível validar a estrutura HTML real de ezmanga.org/nyxscans.com a
partir deste ambiente de desenvolvimento (bloqueado por proteção anti-bot
mesmo pra leitura simples). Rode manualmente pela aba Actions após configurar
as secrets e ajuste `scraper/common.py`/`scraper/discover_fontes.py` se algum
site precisar de um parser dedicado.

## 7. Preenchimento em massa (autor, capítulo, status, score, gênero, tag…)

A maioria das obras importadas da planilha só tem título (e às vezes tipo)
preenchido. Pra completar em lote, sem precisar editar obra por obra no app:

1. No painel do Supabase, vá em **Table Editor → obras → Export data → CSV**.
2. Abra o CSV no Excel/Google Sheets e preencha o que quiser (não precisa
   fazer tudo de uma vez). Não mexa nas colunas `id` e `titulo` — são usadas
   pra casar cada linha na hora de atualizar. Células vazias mantêm o valor
   atual do banco (não apagam nada).
3. Em **generos** e **tags**, separe múltiplos valores com `;`, por exemplo:
   `Romance;Fantasy;Drama`.
4. Rode:
   ```bash
   node scripts/update-from-csv.mjs caminho/para/obras-preenchido.csv
   ```
   (requer `scripts/.env` com `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`,
   igual ao passo 3 de importação inicial)

Esse fluxo é repetível — pode exportar, preencher um pouco, importar,
exportar de novo mais tarde, etc.

## 8. Edge Functions

```bash
supabase functions deploy scraper-control   # dispara/cancela os workflows do GitHub Actions (secret GH_ACTIONS_TOKEN)
supabase functions deploy comix-fetch       # busca páginas de título do comix.to (sem secrets — ver supabase/functions/comix-fetch/README.md)
```

## 9. Aba Reader (download/leitura de novels)

Painel das novels que são baixadas pra ler offline no celular. A divisão que
guia todo o desenho: **detectar é automático, baixar é sempre decisão sua** — a
varredura (fase seguinte) só descobre capítulos novos e datas de liberação de
paywall; nada é baixado sem você escolher a fonte.

Rode `supabase/migrations/0021_reader.sql`, `0022_reader_chave_capitulo.sql` e
o bloco `reader` do `supabase/storage.sql` antes de usar. (O projeto tem
histórico de migrations rastreadas — dá pra aplicar por `apply_migration` em vez
de colar no SQL Editor; foi assim que a 0021 subiu.)

**O que já funciona:** as duas listas (In progress / Completed), o cadastro de
obras e de grupos de tradução com faixas de capítulo, a lista de capítulos com
seus estados, e o preview editável (capa / informações / capítulos).

**O que ainda não:** os botões *Download*, *Generate EPUB/PDF* e *Send to
Kindle* estão desabilitados — dependem do downloader, que é a próxima fase.

Detalhes do modelo:

- `reader_fontes` é grupo de tradução **e** origem de download ao mesmo tempo —
  são o mesmo dado visto de dois ângulos. O campo "Translation" da página de
  informações (`1-150 Eternalune / 151-X Novelupdates`) é derivado dela. Faixas
  sobrepostas são permitidas de propósito: é o caso em que você escolhe de qual
  grupo baixar; `preferida` só define o default.
- `reader_capitulos` é uma máquina de estados (`descoberto → bloqueado →
  baixado → formatado → publicado`). `descoberto` é estado de **espera pela sua
  decisão**, não fila de trabalho. O painel é derivado desses estados por
  `resumirReader` (`src/lib/reader.ts`), que ganha do `reader_obras.estado`
  gravado — assim um job que morreu no meio não deixa a obra "baixando" pra
  sempre.
- Paywall vive em `disponivel_em` (data). Um capítulo `bloqueado` cuja data já
  passou aparece como liberado sem precisar que alguém reescreva o estado — o
  que importa porque a varredura é quinzenal.
- Página de informações: campos vazios **herdam** de `obras`. O checkbox "also
  save to the work" por campo decide se a edição também grava no cadastro (e aí
  o espelhamento manga↔novel existente acontece de graça). Mão única: editar a
  obra pela tela dela não volta pro Reader.
- Identidade do capítulo é `reader_capitulos.chave` (número normalizado:
  `143.2`, `ss-3`), **não** a URL. Motivo concreto na seção de sites abaixo.

### Sites: quem já tem adaptador

Investigação feita ao vivo em 2026-08. A boa notícia é que o registry de
`scraper/adapters.py` casa por **fingerprint de conteúdo**, não por domínio —
então um site novo de uma família conhecida se encaixa sozinho, sem código.

| Site | Plataforma | Adaptador |
|---|---|---|
| bellerepository.com | WordPress + tema Madara | `madara` (por fingerprint) |
| hazelnade.com | WordPress + Madara (+ plugins de capítulo premium) | `madara` |
| eternalune.com | WordPress + Madara | `madara` (por fingerprint) |
| nyxscans.com | Next.js (payload RSC) | `cms-generico` |
| sakuraze.vercel.app | SPA React; API Supabase pública própria | `sakuraze` |
| readhive.org | HTML server-side | `readhive` |

Os três primeiros são o mesmo tema, então **um adaptador cobre metade da
lista**. Pra cadastrar um site novo: insira o domínio em `sites_suportados` e
rode `designar_adaptadores.py` — ele casa sozinho e, se não casar, guarda o
diagnóstico de qual família chegou mais perto.

**Madara (`scraper/adapters_novos.py`)** — a lista de capítulos não vem no HTML
inicial; é um **POST** para `<url-da-obra>/ajax/chapters/?t=1` que devolve tudo
numa resposta só (confirmado: 148 capítulos no eternalune, 284 no
bellerepository, com `curl` simples e sem anti-bot).

Cada capítulo vem assim, e é daqui que sai o paywall:

```html
<li class="wp-manga-chapter to_be_free premium coin-10 data-chapter-14124 premium-block">
  <a href="#"> Chapter 143.2 <i class="fas fa-lock"></i></a>
  <span class="chapter-release-date"><i>Mar 11, 2026</i></span>
  <span class="soon_free">Unlocked on Aug 15, 2026</span>
</li>
```

Duas consequências que valem lembrar antes de mexer nisso:

- `soon_free` traz **a data de liberação já calculada** — é a origem do
  `disponivel_em`, sem heurística de "em N dias".
- Capítulo bloqueado tem `href="#"`, ou seja **não tem URL**, e ganha uma
  quando o paywall cai. Por isso a identidade do capítulo é a `chave`
  normalizada e não a URL: com URL, os bloqueados colidiriam entre si e um
  capítulo liberado viraria linha nova.

`MadaraAdapter.parse()` continua devolvendo só o último capítulo (é o que o
`update_fontes.py` precisa) e **ignora os bloqueados de propósito**. Quem lê a
lista inteira, com bloqueio e data, é `listar_capitulos()`.

**lncrawl** — o [lightnovel-crawler](https://github.com/lncrawl/lightnovel-crawler)
foi avaliado e **não cobre nenhum** dos seis sites acima (procurado no índice de
fontes dele). Não vale como dependência; vale como referência de limpeza de
corpo de capítulo. Registrado aqui pra ninguém reinvestigar.

### Varredura

`scraper/reader_varredura.py` lê a **lista** de capítulos (rótulo, data,
bloqueado ou não) e grava em `reader_capitulos` como `descoberto`/`bloqueado`.
Não lê nem baixa texto de capítulo — isso é a fase seguinte, e é sempre
disparado por você.

```bash
python scraper/reader_varredura.py                # todas as obras do Reader
python scraper/reader_varredura.py --obra <uuid>  # só uma (útil pra estrear)
```

É idempotente: rodar duas vezes atualiza as linhas existentes em vez de
duplicar. O workflow `.github/workflows/reader-varredura.yml` existe só com
disparo manual — o cron quinzenal está comentado, pra ligar quando quiser.

## Estrutura do repositório

```
src/            frontend (React + TS)
supabase/       schema.sql, storage.sql
data/           CSVs originais da planilha (listas, obras, fontes)
scripts/        import-data.mjs / update-from-csv.mjs (dados), migrate_capas.py (capas) — rodam localmente
src/lib/reader.ts   lógica derivada da aba Reader (estado do pipeline, faixas de fonte) — pura, testada
scraper/        update_fontes.py, discover_fontes.py — rodam via cron no GitHub Actions
.github/workflows/  deploy.yml (GitHub Pages), scraper.yml (cron)
```
