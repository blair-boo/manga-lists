# Minha Lista (manga-lists)

PWA local-first (Vite + React + TypeScript + Dexie + Supabase) para controle de
leitura de mangás, manhwas, manhuas e novels, publicado no GitHub Pages. Tem um
scraper em Python (`scraper/`) rodando em GitHub Actions. O README tem o passo a
passo de configuração; este arquivo tem as regras de trabalho.

## Idioma

- Nomes de variáveis, funções, arquivos e comentários: português.
- Textos de interface: inglês (ex.: "Synced at", "Hard Sync", "Empty Cache").
- Mensagens de commit e título de PR: inglês. Corpo do PR segue
  `.github/pull_request_template.md` (Summary e Test plan).

## Antes de dizer que terminou

Rodar `npm run lint`, `npm test` e `npm run build`. Se mexeu em `scraper/`, rodar
também `python -m pytest scraper/tests` (dependências em
`scraper/requirements-dev.txt`). Se algum falhar, corrigir ou avisar de forma
explícita. Não declarar pronto sem ter rodado, e dizer o que ficou sem fazer.

O deploy (`deploy.yml`, push na `main`) roda `npm test` antes do build: teste
quebrado deixa o GitHub Pages na versão antiga.

## Dados e sincronização (a parte mais delicada)

O app lê e escreve no Dexie (IndexedDB) e sincroniza com o Supabase em segundo
plano (`src/sync/sync.ts`). Regras:

- Toda escrita de dados sincronizados passa por `src/db/repo.ts` (grava no Dexie,
  enfileira com `enqueueMutation` e dispara o sync). Nunca gravar direto no
  Supabase nem direto no Dexie a partir de componentes.
- Coluna nova no Supabase também entra na lista `COLUNAS_*` da entidade em
  `src/sync/sync.ts` e no tipo em `src/types/index.ts`. Sem isso o campo é
  descartado no envio (`sanitizarPayload`).
- Tabela com pull incremental precisa da coluna `atualizado_em` mantida por
  trigger (`set_atualizado_em`). `fontes` e `listas` não têm e fazem refresh
  completo.
- Os nomes das tabelas do Dexie que espelham o Supabase (`reader_*`) precisam ser
  iguais aos do Supabase, porque o sync usa o nome da entidade direto.
- Nunca apagar blocos antigos de `this.version(n)` em `src/db/localDb.ts`: o
  Dexie funde as versões e apagar zera instalações existentes. Mudança de schema
  local vira `version(n+1)` novo.
- Nenhuma guarda de pendência pode ser removida (`pullIncremental`,
  `reconciliarTabela`, `reconciliarObrasDeletadas`): elas impedem que o pull
  apague edição local ainda não enviada.
- Teste que importa `repo.ts` ou `sync.ts` precisa mockar `supabaseClient`
  (ele lança no import sem as variáveis de ambiente). Ver `src/db/repo.test.ts`.

## Banco

- Mudança de schema vira migration numerada em `supabase/migrations` e também
  entra em `supabase/schema.sql`. Buckets e policies ficam em `supabase/storage.sql`.
- Tabela nova com RLS segue o padrão `authenticated_full_access_*` do
  `schema.sql` (a chave `anon` fica pública no bundle, por isso o app não tem
  cadastro e o acesso é só para a conta criada no painel).

## Interface

- Reutilizar antes de criar: `ModalBase` (modais), `useDialogos()` (`confirmar` e
  `pedirTexto`, no lugar de `confirm()`/`prompt()` nativos, que fogem do tema no
  iOS), `useToast()` (retorno de sucesso e erro), `useAsyncAction`.
- Ícones vêm do bucket `icons` do Supabase Storage por `IconeMascarado` em
  `src/components/Icones.tsx`. Nunca emoji nem caractere solto como ícone.
- Todo botão só de ícone leva `title` e `aria-label`.
- CSS em `src/styles`, um arquivo por área; usar as variáveis existentes
  (`var(--bg)`, `var(--text)`, `var(--border)`, `var(--danger)`, `var(--accent)`).
  Sem `style` inline.
- Ação destrutiva sempre com `confirmar({ ..., perigoso: true })`.

## Scraper e backup

- Scraper em `scraper/` (Python), um workflow por estágio em `.github/workflows`.
  Segredos de scraping ficam nos secrets do GitHub, nunca no código.
- Backup semanal para o Cloudflare R2: `scraper/backup_supabase.py` e
  `.github/workflows/backup.yml`; verificação e restauração em
  `scripts/restaurar-supabase.mjs`. Detalhes na seção 10 do README.

## Ideias combinadas para depois

Ver `docs/IDEIAS_FUTURAS.md` antes de propor algo novo: lá estão as sugestões que
a usuária já aprovou para fazer mais tarde.
