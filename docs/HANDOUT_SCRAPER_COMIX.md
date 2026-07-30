# HANDOUT_SCRAPER_COMIX

Adaptador de scraper para **comix.to** (e o domínio espelho **comix.ws**).

**Modelo de execução:** Sonnet. Tarefa prescritiva, um arquivo novo de classe + registro + testes. Sem Fase 0 (execução por modelo único).

Salvar este handout como `docs/HANDOUT_SCRAPER_COMIX.md`.

---

## 0. O que foi verificado e o que é inferência

Leitura direta do HTML da página de obra e do bundle `main-tiv3b5-D41wynCQ.js`. Separação importante para a implementação:

**Verificado (não precisa checar de novo):**

- A página de obra é uma casca de SPA com o estado embutido em `<script type="application/json" id="initial-data">`.
- Esse blob é um cache de React Query: `{"page":"manga","queries":{...},"manga":{"hid":...,"id":...}}`.
- A chave `["manga","detail","<hid>"]` traz o registro completo da obra, incluindo `latestChapter` (número) e `latestChapterUrl` (relativa).
- A lista de capítulos **não** está no blob. Vem de chamada client-side.
- O `<meta name="cfg">` **não é autenticação**. É o sitekey do Cloudflare Turnstile, consumido só pelos formulários de login/registro/reset. Leitura anônima não precisa dele. Não implementar nada em torno desse token.
- A navegação interna usa um mini-Turbo próprio que refaz `fetch` da página e relê o `#initial-data`. Ou seja, qualquer rota do site responde HTML completo com o blob. `requests` basta, sem Playwright.
- A base da API é `/api/v1` (literais confirmados: `/api/v1/auth/google/redirect`, `/api/v1/user/manga/{id}/progress`).
- Busca e catálogo são a **mesma** função no cliente (`N.list(params)`), com os parâmetros da tabela na seção 3.
- Capítulos usam o **`hid`** (string curta), não o id numérico.
- Não existe parâmetro de idioma em nenhum filtro do site.
- Não existe campo de lock/paywall/moeda nos itens de capítulo renderizados.

**Inferência (precisa verificar em implementação):**

- Os paths finais dos endpoints. Sabemos a base `/api/v1` e os parâmetros, mas as constantes de rota (`W.manga.list`, `W.manga.chapters`) moram no bundle `env-tiv3b5-C62t0jdR.js`, que não foi lido. Ver seção 5.
- A serialização exata dos parâmetros aninhados (`order`). Ver seção 5.

Onde este handout marca **[VERIFICAR]**, rodar a checagem descrita antes de fixar o código.

---

## 1. Decisão de arquitetura

O estágio de **capítulos** (`update_fontes.py`) não usa API nenhuma. O `latestChapter` já vem no HTML da página da obra. Isso torna o caminho crítico do scraper trivial e imune a mudança de rota de API.

A API só é necessária para **catálogo** (`update_obras.py`) e **busca** (`discover_fontes.py`).

Consequência prática: se a descoberta de endpoint da seção 5 falhar, o adaptador ainda entrega valor completo no estágio de capítulos. Implementar nessa ordem: `parse()` primeiro, catálogo/busca depois.

---

## 2. Novo adaptador em `scraper/adapters_novos.py`

Adicionar a classe abaixo. Ela segue a interface de `adapter_base.py` (`SourceAdapter`, `RawContent`, `ParseResult`, `STATUS_*`).

```python
_COMIX_INITIAL_DATA_RE = re.compile(
    r'<script[^>]+id=["\']initial-data["\'][^>]*>(.*?)</script>',
    re.IGNORECASE | re.DOTALL,
)
_COMIX_HID_RE = re.compile(r"/title/([0-9A-Za-z]+)-")


def _sem_espacos(s: str) -> str:
    return "".join(s.split())


class ComixAdapter(SourceAdapter):
    """
    Comix (comix.to / comix.ws): SPA que embute o cache do React Query no HTML
    inicial, em `<script id="initial-data">`. O registro da obra fica na chave
    `["manga","detail","<hid>"]` e já traz `latestChapter` / `latestChapterUrl`,
    então o estágio de capítulos NÃO chama API: lê o HTML e pronto.

    O `<meta name="cfg">` da página é o sitekey do Turnstile (captcha dos
    formulários de conta), não um token de acesso. Leitura é anônima.

    Catálogo e busca usam o mesmo endpoint de listagem da API (`/api/v1`),
    variando só os parâmetros. Ver `_endpoint_lista`.
    """

    id = "comix"
    display_name = "Comix (initial-data / React Query)"
    access_strategy_padrao = ACCESS_HTTP

    # --- leitura do blob ---------------------------------------------------

    def _initial_data(self, texto: str) -> dict | None:
        m = _COMIX_INITIAL_DATA_RE.search(texto or "")
        if not m:
            return None
        try:
            dados = json.loads(m.group(1))
        except ValueError:
            return None
        return dados if isinstance(dados, dict) else None

    def _hid_da_url(self, url: str) -> str | None:
        m = _COMIX_HID_RE.search(url or "")
        return m.group(1) if m else None

    def _detalhe(self, dados: dict, url: str) -> dict | None:
        """
        Registro da obra. Tenta a chave exata montada a partir do hid da URL e,
        se não bater (hid ausente ou chave com espaçamento diferente), cai numa
        varredura estrutural por qualquer chave `["manga","detail",...]`.
        """
        queries = dados.get("queries")
        if not isinstance(queries, dict):
            return None

        hid = self._hid_da_url(url)
        if hid:
            chave = json.dumps(["manga", "detail", hid], separators=(",", ":"))
            alvo = queries.get(chave)
            if isinstance(alvo, dict):
                return alvo

        for k, v in queries.items():
            if isinstance(v, dict) and _sem_espacos(k).startswith('["manga","detail"'):
                return v
        return None

    # --- interface do adaptador -------------------------------------------

    def matches(self, url: str) -> bool:
        # Reconhecimento pelo conteúdo, não pelo hostname: cobre comix.to,
        # comix.ws e qualquer outro espelho sem tocar no código.
        raw = fetch_http(url)
        if raw.status != "ok" or not raw.text:
            return False
        dados = self._initial_data(raw.text)
        if not dados:
            return False
        queries = dados.get("queries")
        return isinstance(queries, dict) and any(
            _sem_espacos(k).startswith('["manga","detail"') for k in queries
        )

    def parse(self, raw: RawContent) -> ParseResult:
        if raw.status == "acesso_bloqueado":
            return ParseResult(STATUS_BLOQUEADO, diagnostico=raw.diagnostico)
        if raw.status != "ok" or not raw.text:
            return ParseResult(STATUS_ERRO, diagnostico=raw.diagnostico or "sem conteúdo")

        dados = self._initial_data(raw.text)
        if dados is None:
            return ParseResult(STATUS_INVALIDA, diagnostico="não achei o bloco #initial-data")

        detalhe = self._detalhe(dados, raw.url)
        if detalhe is None:
            return ParseResult(
                STATUS_INVALIDA, diagnostico='initial-data sem chave ["manga","detail",...]'
            )

        titulo_site = detalhe.get("title") or None
        tipo_detectado = self._tipo(detalhe, raw)

        if not detalhe.get("hasChapters"):
            return ParseResult(
                STATUS_VAZIA,
                titulo_site=titulo_site,
                tipo_detectado=tipo_detectado,
                diagnostico="obra reconhecida, ainda sem capítulos (hasChapters=false)",
            )

        numero = detalhe.get("latestChapter")
        if not isinstance(numero, (int, float)) or numero <= 0:
            return ParseResult(
                STATUS_VAZIA,
                titulo_site=titulo_site,
                tipo_detectado=tipo_detectado,
                diagnostico=f"latestChapter ausente ou inválido: {numero!r}",
            )
        numero = int(numero) if float(numero).is_integer() else float(numero)

        return ParseResult(
            STATUS_OK,
            titulo_site=titulo_site,
            tipo_detectado=tipo_detectado,
            ultimo_capitulo=numero,
            link_capitulo=self._absoluta(raw.url, detalhe.get("latestChapterUrl")),
        )
```

### Detecção de tipo

O site é só de quadrinhos. O campo `type` do payload assume `manga`, `manhwa`, `manhua` ou `other`, todos da família **manga** no modelo do projeto (`familia_de_tipo`). Não há novels no catálogo.

```python
    def _tipo(self, detalhe: dict, raw: RawContent) -> str | None:
        tipo = str(detalhe.get("type") or "").lower()
        if tipo in ("manga", "manhwa", "manhua", "other"):
            return "manga"
        if tipo == "novel":
            return "novel"
        # Tipo desconhecido (campo novo no site): cai na heurística compartilhada.
        return detectar_tipo(raw.url, raw.text or "")
```

### Helper de URL absoluta

```python
    def _absoluta(self, url_pagina: str, caminho: str | None) -> str | None:
        if not caminho:
            return None
        return urljoin(url_pagina, caminho)
```

`urljoin` precisa estar importado no módulo (`from urllib.parse import urljoin`). Conferir se já está.

---

## 3. Catálogo e busca

### Endpoint de listagem

Ambos usam o mesmo endpoint, variando parâmetros. Parâmetros confirmados no bundle:

| Parâmetro | Formato | Uso |
|---|---|---|
| `keyword` | string | termo de busca |
| `order` | objeto, ex. `{"chapter_updated_at": "desc"}` | ordenação |
| `page` | inteiro, base 1 | paginação |
| `limit` | inteiro (o app usa 28 no browse, 31 na home, 12 na busca) | tamanho da página |
| `types` | lista: `manga`, `manhwa`, `manhua`, `other` | filtro de tipo |
| `statuses` | lista: `releasing`, `finished`, `on_hiatus`, `discontinued` | filtro de status |
| `content_rating` | lista: `safe`, `suggestive`, `erotica`, `pornographic` | filtro de classificação |
| `genres_in` / `genres_ex` | listas de ids | gêneros incluídos/excluídos |
| `genres_mode` | `and` ou `or` | modo do filtro de gênero |
| `demographics`, `authors`, `artists` | listas de ids | |
| `year_from`, `year_to`, `min_chap` | inteiros | |

Chaves de ordenação disponíveis: `relevance`, `chapter_updated_at`, `created_at`, `title`, `year`, `score`, `views_7d`, `views_30d`, `views_90d`, `views_total`, `follows_total`. Direção `asc` ou `desc`.

Resposta:

```json
{ "items": [ ... ], "meta": { "total": 0, "page": 1, "lastPage": 1, "hasNext": false, "hasPrev": false } }
```

Cada item traz `id`, `hid`, `title`, `altTitles`, `type`, `status`, `url` (canônica relativa), `latestChapter`, `poster`, entre outros.

**Não usar `altTitles`.** Decisão da dona: o catálogo alimenta o match só com `title`. Manter o campo fora do retorno para não inflar memória em catálogos grandes.

### Implementação

```python
    def _base(self, url: str) -> str:
        return f"https://{host_de_url(url)}"

    def _endpoint_lista(self, url: str) -> str:
        return f"{self._base(url)}{_COMIX_PATH_LISTA}"

    def _consultar(self, url: str, params: dict) -> tuple[list[dict], dict]:
        """Uma página do endpoint de listagem: (items, meta). Erros viram ([], {})."""
        try:
            resp = http_get(self._endpoint_lista(url), params=params)
            resp.raise_for_status()
            dados = resp.json()
        except (requests.RequestException, ValueError):
            return [], {}
        if not isinstance(dados, dict):
            return [], {}
        itens = dados.get("items")
        meta = dados.get("meta")
        return (itens if isinstance(itens, list) else []), (meta if isinstance(meta, dict) else {})

    def listar_catalogo(self, url: str) -> list[tuple[str, str]]:
        """(título, url relativa) de todo o catálogo, paginando por meta.lastPage."""
        resultado: list[tuple[str, str]] = []
        pagina = 1
        while pagina <= _COMIX_MAX_PAGINAS:
            itens, meta = self._consultar(
                url,
                {
                    "page": pagina,
                    "limit": _COMIX_LIMITE_PAGINA,
                    **_order({"chapter_updated_at": "desc"}),
                },
            )
            if not itens:
                break
            for it in itens:
                titulo = it.get("title")
                caminho = it.get("url")
                if titulo and caminho:
                    resultado.append((str(titulo), str(caminho)))
            if not meta.get("hasNext"):
                break
            pagina += 1
            time.sleep(_COMIX_DELAY)
        return resultado

    def buscar(self, url: str, titulo: str) -> list[tuple[str, str]]:
        itens, _ = self._consultar(
            url,
            {"keyword": titulo, "limit": 12, **_order({"relevance": "desc"})},
        )
        return [
            (str(it["title"]), str(it["url"]))
            for it in itens
            if it.get("title") and it.get("url")
        ]

    def url_da_fonte(self, url: str, slug: str) -> str:
        # `slug` aqui é a URL canônica relativa que a API já devolve pronta.
        return urljoin(self._base(url) + "/", slug.lstrip("/"))
```

Constantes de módulo:

```python
_COMIX_LIMITE_PAGINA = 100   # ajustar se a API impuser teto menor (ver seção 5)
_COMIX_MAX_PAGINAS = 400     # trava de segurança contra loop infinito
_COMIX_DELAY = 0.5           # segundos entre páginas do catálogo
```

O `time` precisa estar importado no módulo.

---

## 4. Registro no `REGISTRY`

Em `scraper/adapters.py`:

1. Adicionar `ComixAdapter` ao import de `adapters_novos`.
2. Inserir a instância no `REGISTRY`.

**Posição:** logo após `EzmangaAdapter()` e antes de `NovelsHubAdapter()`. Justificativa: o `matches` do Comix é específico (exige a chave `["manga","detail"` no blob), então não rouba detecção de ninguém, mas colocá-lo cedo evita que adaptadores genéricos de HTML tentem parsear a casca vazia da SPA antes.

Conferir também que o import de `detectar_tipo` já existe em `adapters_novos.py`; se não, adicionar.

---

## 5. [VERIFICAR] Descoberta do endpoint

Duas incógnitas precisam de confirmação empírica contra o site. Fazer isso **antes** de fechar a implementação de catálogo/busca. A implementação de `parse()` (capítulos) não depende disto e pode ser concluída independentemente.

### 5.1 Path da listagem

Candidatos, em ordem de probabilidade:

```
/api/v1/manga
/api/v1/mangas
/api/v1/comics
/api/v1/titles
```

Procedimento: para cada candidato, `GET https://comix.to{candidato}?page=1&limit=1` e verificar se a resposta é JSON com a forma `{"items": [...], "meta": {...}}`. Fixar o vencedor em `_COMIX_PATH_LISTA` no topo do módulo, com comentário registrando a data da verificação.

Se nenhum bater, o path está no bundle `env-tiv3b5-C62t0jdR.js`. Baixar
`https://comix.to/assets/build/35595e3de3c99889c1aa70/dist/env-tiv3b5-C62t0jdR.js`
e procurar pelas constantes de rota (o objeto exportado como `W`, com chaves `manga`, `comments`, `users`, `collections`). O hash do caminho de build muda entre deploys: se der 404, ler o `src` do `<script type="module">` no HTML da home para pegar o hash atual.

### 5.2 Serialização do `order`

O cliente é axios. O serializador padrão do axios converte objetos aninhados com `JSON.stringify`, o que produziria:

```
?order=%7B%22chapter_updated_at%22%3A%22desc%22%7D
```

e arrays como `types[]=manga&types[]=manhwa`.

Mas o app pode definir um `paramsSerializer` customizado (estaria no `env-*.js`, não lido). A alternativa comum é a notação de colchetes:

```
?order[chapter_updated_at]=desc
```

Procedimento: testar as duas contra o endpoint confirmado, comparando o primeiro item retornado com `order` de `title:asc` versus `title:desc`. Se a ordem mudar, a serialização está correta. Se os dois formatos derem o mesmo resultado, o parâmetro está sendo ignorado e nenhum dos dois é o certo.

Implementar o helper `_order` conforme o vencedor:

```python
def _order(criterio: dict) -> dict:
    """Serialização dos parâmetros de ordenação. Formato confirmado em <data>."""
    # Variante A (axios padrão):
    return {"order": json.dumps(criterio, separators=(",", ":"))}
    # Variante B (colchetes):
    # return {f"order[{k}]": v for k, v in criterio.items()}
```

Deixar a variante perdedora comentada com uma linha explicando por que foi descartada.

### 5.3 Teto do `limit`

Testar `limit=100`. Se a API capar (retornar menos itens que o pedido com `hasNext` verdadeiro), ajustar `_COMIX_LIMITE_PAGINA` para o maior valor aceito. O app usa 28 e 31, então 100 pode ou não passar.

---

## 6. Testes

Em `scraper/tests/`, seguindo o padrão de `test_adapters.py`.

### Fixture

Criar `scraper/tests/fixtures/comix_title.html` a partir do HTML real já capturado da obra "Marchioness Maron". Reduzir o blob JSON ao mínimo necessário (a chave `detail` completa, mais uma chave `groups` vazia), preservando a estrutura externa exata. Não reformatar o JSON: manter o formato de chave sem espaços, que é o que o parser encontra na vida real.

### Casos

```python
def test_comix_parse_ok():
    raw = RawContent("ok", "https://comix.to/title/l78rz-marchioness-maron",
                     text=fixture("comix_title.html"))
    r = ComixAdapter().parse(raw)
    assert r.status == STATUS_OK
    assert r.ultimo_capitulo == 48
    assert isinstance(r.ultimo_capitulo, int)
    assert r.titulo_site == "Marchioness Maron"
    assert r.tipo_detectado == "manga"
    assert r.link_capitulo == (
        "https://comix.to/title/l78rz-marchioness-maron/11128392-chapter-48"
    )
```

Demais casos a cobrir:

- **Capítulo decimal:** fixture com `latestChapter: 48.5` devolve `float`, não `int`.
- **`hasChapters: false`** devolve `STATUS_VAZIA`, não erro, e ainda preenche `titulo_site`.
- **`latestChapter: 0`** devolve `STATUS_VAZIA`.
- **HTML sem o bloco `#initial-data`** devolve `STATUS_INVALIDA` sem levantar exceção.
- **Blob presente mas sem chave `detail`** (ex.: página de browse) devolve `STATUS_INVALIDA`.
- **Fallback estrutural:** URL sem hid reconhecível (ex.: `https://comix.to/algo`) mas blob com a chave `detail` presente ainda encontra o registro.
- **`RawContent` com status `acesso_bloqueado`** devolve `STATUS_BLOQUEADO`.
- **`_hid_da_url`** extrai `l78rz` de `/title/l78rz-marchioness-maron` e devolve `None` para `/browse?types=manga`.
- **`url_da_fonte`** monta absoluta corretamente a partir de uma relativa com e sem barra inicial.

Não escrever teste que dependa de rede.

---

## 7. Registro do domínio

Inserir em `sites_suportados` (via Supabase):

| campo | comix.to | comix.ws |
|---|---|---|
| `nome` | `comix` | `comix-ws` |
| `url_base` | `https://comix.to` | `https://comix.ws` |
| `adaptador` | `comix` | `comix` |
| `access_strategy` | `http` | `http` |
| `ativo` | true | false |

O `comix.ws` entra inativo, como reserva. O próprio site anuncia esse domínio como alternativa quando o principal fica inacessível. Se o `.to` cair, basta virar o `ativo` sem tocar em código, já que o `matches` é por conteúdo.

---

## 8. Ressalvas registradas

Duas hipóteses ficaram sem prova negativa. Nenhuma bloqueia a implementação, mas devem virar comentário na docstring da classe para quem mexer depois:

1. **Escopo do `latestChapter`.** Não há parâmetro de idioma em nenhum filtro do site, o que sugere catálogo monolíngue, mas isso não é prova. Se o número reportado divergir do que é legível na prática, investigar aqui primeiro.
2. **Capítulos bloqueados.** Nenhum campo de lock, moeda ou paywall aparece nos itens de capítulo renderizados pelo app. Mesma observação: divergência sistemática de contagem aponta para cá.

Ambas se resolvem comparando o `latestChapter` do HTML com uma chamada de capítulos ordenada por `{"number": "desc"}` numa obra qualquer, depois que o endpoint da seção 5 estiver confirmado. Vale fazer uma vez e anotar o resultado.

---

## 9. Observação estratégica

A chave `["manga","groups","<hid>"]` do blob lista as scans que hospedam a obra. Na amostra analisada apareceram **EZManga, Nyx Scans e Valir Scans**, domínios que já têm ou terão adaptador dedicado no projeto.

Se a cobertura se confirmar em escala, o comix funciona como fonte agregada única cobrindo vários sites, com parser bem mais simples e estável que os individuais. Vale medir antes de investir em mais adaptadores por site.

Isto **não** é escopo deste handout. Fica registrado como insumo de decisão.

---

## Checklist de verificação

- [ ] `ComixAdapter` criado em `adapters_novos.py` e registrado no `REGISTRY` de `adapters.py`, após `EzmangaAdapter`
- [ ] `parse()` extrai `latestChapter` e `latestChapterUrl` do HTML, sem nenhuma chamada de API
- [ ] Nenhum código toca no `<meta name="cfg">`
- [ ] `matches()` reconhece pelo conteúdo, não pelo hostname (testar com `comix.to`; `comix.ws` deve funcionar sem alteração)
- [ ] Capítulo inteiro volta como `int`, decimal como `float`
- [ ] `hasChapters: false` e `latestChapter: 0` viram `STATUS_VAZIA`, não erro
- [ ] Path do endpoint de listagem confirmado empiricamente e fixado com data no comentário
- [ ] Serialização do `order` confirmada empiricamente; variante descartada deixada comentada
- [ ] Teto real do `limit` confirmado
- [ ] `listar_catalogo` pagina por `meta.hasNext` com trava de `_COMIX_MAX_PAGINAS` e delay entre páginas
- [ ] `listar_catalogo` e `buscar` devolvem só `(title, url)`, sem `altTitles`
- [ ] Fixture `comix_title.html` criada a partir do HTML real, com o JSON no formato original
- [ ] Todos os casos de teste da seção 6 passam, nenhum dependendo de rede
- [ ] `comix.to` (ativo) e `comix.ws` (inativo) inseridos em `sites_suportados`
- [ ] Rodar `update_fontes.py` numa fonte comix real e conferir que `ultimo_capitulo_detectado` e o link batem com o site
- [ ] Ressalvas da seção 8 registradas na docstring da classe
