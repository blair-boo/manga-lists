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

**Nota sobre o scraper:** a extração de número de capítulo é feita por uma
heurística genérica (padrões tipo `chapter-123` em links/texto), já que não
foi possível validar a estrutura HTML real de ezmanga.org/nyxscans.com a
partir deste ambiente de desenvolvimento (bloqueado por proteção anti-bot
mesmo pra leitura simples). Rode manualmente pela aba Actions após configurar
as secrets e ajuste `scraper/common.py`/`scraper/discover_fontes.py` se algum
site precisar de um parser dedicado.

## Estrutura do repositório

```
src/            frontend (React + TS)
supabase/       schema.sql, storage.sql
data/           CSVs originais da planilha (listas, obras, fontes)
scripts/        import-data.mjs (dados), migrate_capas.py (capas) — rodam uma vez, localmente
scraper/        update_fontes.py, discover_fontes.py — rodam via cron no GitHub Actions
.github/workflows/  deploy.yml (GitHub Pages), scraper.yml (cron)
```
