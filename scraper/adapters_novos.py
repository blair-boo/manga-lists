"""
Adaptadores novos (ver HANDOUT_SCRAPERS_NOVELSHUB_TS_MADARA): novelshub,
readhive, ts_theme, mgread, madara, vymanga, mangafox, sakuraze.

Módulo separado do `adapters.py` só por tamanho — reusa a mesma interface
(`SourceAdapter`, `RawContent`, `ParseResult`, fetchers, `STATUS_*`) definida
lá. `adapters.py` importa e registra as classes daqui.

Todas as famílias foram verificadas contra HTML real (fetch direto, IP deste
ambiente) em 2026-07-17, o que corrigiu algumas premissas do handout — cada
classe documenta a correção quando houve uma.
"""

import json
import re
from urllib.parse import urlparse
from xml.etree import ElementTree

import requests

from adapter_base import (
    ACCESS_HTTP,
    FETCHERS,
    RawContent,
    ParseResult,
    SourceAdapter,
    STATUS_BLOQUEADO,
    STATUS_ERRO,
    STATUS_INVALIDA,
    STATUS_OK,
    STATUS_VAZIA,
    fetch_http,
)
from tipo_titulo import detectar_tipo, extrair_titulo_pagina

# --- A1a. novelshub (Next.js, multi-tenant SaaS) ----------------------------


class NovelsHubAdapter(SourceAdapter):
    """
    Plataforma multi-tenant (valirscans.org, divascans.org, ...). Reconhecida
    pelo marcador `novelshub-site-theme` no HTML, não por domínio fixo.

    Desvio do handout (mais simples e confirmado ao vivo): em vez de parsear
    o payload RSC `self.__next_f.push(...)` com balanced-bracket e resolver a
    paginação de >100 capítulos, cada série expõe um RSS em
    `{url_da_serie}/feed.xml` — os itens já vêm em ordem decrescente por
    capítulo, então o item[0] é sempre o último lançado (o único dado que
    `atualizar_obras` precisa), sem lidar com paginação. O `type` do JSON não
    fica mais acessível com essa rota; a detecção de tipo cai para o sinal de
    URL (`por_url`, que já cobre 'comic'/'manga'/'manhwa'/'novel' no path).
    """

    id = "novelshub"
    display_name = "NovelsHub (Next.js multi-tenant, via RSS feed.xml)"
    access_strategy_padrao = ACCESS_HTTP

    _CHAPTER_NUM_RE = re.compile(r"(\d+(?:\.\d+)?)")

    def matches(self, url: str) -> bool:
        raw = fetch_http(url)
        return raw.status == "ok" and bool(raw.text) and "novelshub-site-theme" in raw.text

    def fetch(self, url: str, access_strategy: str) -> RawContent:
        feed_url = url.rstrip("/") + "/feed.xml"
        return FETCHERS.get(access_strategy, fetch_http)(feed_url)

    def parse(self, raw: RawContent) -> ParseResult:
        if raw.status == "acesso_bloqueado":
            return ParseResult(STATUS_BLOQUEADO, diagnostico=raw.diagnostico)
        if raw.status != "ok" or not raw.text:
            return ParseResult(STATUS_ERRO, diagnostico=raw.diagnostico or "sem conteúdo")

        try:
            root = ElementTree.fromstring(raw.text)
        except ElementTree.ParseError as exc:
            return ParseResult(STATUS_INVALIDA, diagnostico=f"feed.xml não é XML válido: {exc}")

        itens = root.findall("./channel/item")
        if not itens:
            return ParseResult(STATUS_VAZIA, diagnostico="feed.xml válido, sem <item> (obra sem capítulo lançado?)")

        melhor: tuple[float, str] | None = None
        for item in itens:
            titulo_item = item.findtext("title") or ""
            m = self._CHAPTER_NUM_RE.search(titulo_item)
            if not m:
                continue
            numero = float(m.group(1))
            link = item.findtext("link") or raw.url
            if melhor is None or numero > melhor[0]:
                melhor = (numero, link)

        if melhor is None:
            return ParseResult(STATUS_INVALIDA, diagnostico="itens do feed sem número de capítulo reconhecível no título")

        numero, link = melhor
        numero_fmt = int(numero) if numero.is_integer() else numero
        return ParseResult(
            STATUS_OK, ultimo_capitulo=numero_fmt, link_capitulo=link, tipo_detectado=detectar_tipo(link)
        )


# --- A1b. readhive (Laravel + Unpoly, single-site) --------------------------


class ReadhiveAdapter(SourceAdapter):
    """
    readhive.org — server-rendered com Unpoly (`up-follow`), WordPress por
    baixo (confirmado: redirect com header `x-redirect-by: WordPress`), mas
    NÃO é Madara nem NovelsHub — motor próprio.

    Correção ao handout: a lista completa de capítulos só vem embutida na
    página **overview** da série (`/series/<id>`, sem número de capítulo no
    final) — uma página de leitura específica (`/series/<id>/<n>`) só traz
    prev/next (2-3 links), não a lista inteira. `fetch()` normaliza qualquer
    URL de capítulo pra overview antes de buscar.
    """

    id = "readhive"
    display_name = "Readhive (Laravel/Unpoly, single-site)"
    access_strategy_padrao = ACCESS_HTTP

    _SERIES_ID_RE = re.compile(r"/series/(\d+)")

    def _url_overview(self, url: str) -> str:
        m = self._SERIES_ID_RE.search(urlparse(url).path)
        if not m:
            return url
        p = urlparse(url)
        return f"{p.scheme}://{p.netloc}/series/{m.group(1)}"

    def matches(self, url: str) -> bool:
        raw = fetch_http(url)
        return raw.status == "ok" and bool(raw.text) and "up-follow" in raw.text

    def fetch(self, url: str, access_strategy: str) -> RawContent:
        return FETCHERS.get(access_strategy, fetch_http)(self._url_overview(url))

    def parse(self, raw: RawContent) -> ParseResult:
        if raw.status == "acesso_bloqueado":
            return ParseResult(STATUS_BLOQUEADO, diagnostico=raw.diagnostico)
        if raw.status != "ok" or not raw.text:
            return ParseResult(STATUS_ERRO, diagnostico=raw.diagnostico or "sem conteúdo")

        m = self._SERIES_ID_RE.search(urlparse(raw.url).path)
        if not m:
            return ParseResult(STATUS_INVALIDA, diagnostico="não achei o id da série na URL")
        series_id = m.group(1)

        numeros = [int(n) for n in re.findall(rf'href="[^"]*?/series/{series_id}/(\d+)"', raw.text)]
        if not numeros:
            return ParseResult(STATUS_VAZIA, diagnostico="página reconhecida, sem links de capítulo")

        maior = max(numeros)
        p = urlparse(raw.url)
        link = f"{p.scheme}://{p.netloc}/series/{series_id}/{maior}"
        return ParseResult(STATUS_OK, ultimo_capitulo=maior, link_capitulo=link, tipo_detectado=detectar_tipo(raw.url, raw.text))


# --- A2. ts_theme (Themesia/ts_reader) — kingofshojo, arenascan -------------


class TsThemeAdapter(SourceAdapter):
    """
    WordPress + componente de leitura Themesia/ts_reader. Fingerprint:
    `id="chapterlist"` + `class="eplister"` (confirmado ao vivo em
    kingofshojo.com e arenascan.com — a página da série embute a lista
    completa em `<li data-num="N">` dentro de `#chapterlist`, sem paginação
    nos casos testados).

    Correção ao handout: mgread.io NÃO tem esses marcadores (tema "init-manga",
    estrutura totalmente diferente) — apesar de citado na mesma família no
    handout, é tratado à parte por `MgreadAdapter`.
    """

    id = "ts_theme"
    display_name = "Themesia / ts_reader (kingofshojo, arenascan)"
    access_strategy_padrao = ACCESS_HTTP

    def matches(self, url: str) -> bool:
        raw = fetch_http(url)
        if raw.status != "ok" or not raw.text:
            return False
        return 'class="eplister"' in raw.text and 'id="chapterlist"' in raw.text

    def parse(self, raw: RawContent) -> ParseResult:
        if raw.status == "acesso_bloqueado":
            return ParseResult(STATUS_BLOQUEADO, diagnostico=raw.diagnostico)
        if raw.status != "ok" or not raw.text:
            return ParseResult(STATUS_ERRO, diagnostico=raw.diagnostico or "sem conteúdo")

        m = re.search(r'id="chapterlist"[\s\S]*?</ul>', raw.text)
        if not m:
            return ParseResult(STATUS_INVALIDA, diagnostico='reconheceu eplister/chapterlist, mas não achei a lista <ul id="chapterlist">')

        bloco = m.group(0)
        entradas = re.findall(r'data-num="([0-9.]+)"[\s\S]{0,400}?href="([^"]+)"', bloco)
        if not entradas:
            return ParseResult(STATUS_VAZIA, diagnostico='lista #chapterlist reconhecida, sem itens com data-num (obra sem capítulo?)')

        maior_num, maior_link = max(entradas, key=lambda e: float(e[0]))
        numero = float(maior_num)
        numero_fmt = int(numero) if numero.is_integer() else numero
        return ParseResult(
            STATUS_OK, ultimo_capitulo=numero_fmt, link_capitulo=maior_link, tipo_detectado=detectar_tipo(raw.url, raw.text)
        )


# --- A2b. mgread (tema "init-manga", distinto do ts_theme) ------------------


class MgreadAdapter(SourceAdapter):
    """
    mgread.io — WordPress, mas tema `init-manga` (uikit), sem `eplister`/
    `chapterlist`. Descoberto ao investigar o handout (que agrupava mgread
    com ts_theme por engano): a página da série nem sempre embute a lista
    completa (algumas têm "0 Chapters"; outras mostram só uma janela de
    capítulos), mas o próprio `<title>` da página sempre traz o último
    capítulo publicado (ex.: "... [Ch. 26] – Mgread.io", confirmado
    contra o link mais alto realmente presente na página) — sinal mais
    confiável que enumerar links.
    """

    id = "mgread"
    display_name = "Mgread.io (tema init-manga, single-site)"
    access_strategy_padrao = ACCESS_HTTP

    _TITLE_CH_RE = re.compile(r"\[Ch\.\s*([0-9.]+)\]", re.IGNORECASE)

    def matches(self, url: str) -> bool:
        raw = fetch_http(url)
        return raw.status == "ok" and bool(raw.text) and "/wp-content/themes/init-manga" in raw.text

    def parse(self, raw: RawContent) -> ParseResult:
        if raw.status == "acesso_bloqueado":
            return ParseResult(STATUS_BLOQUEADO, diagnostico=raw.diagnostico)
        if raw.status != "ok" or not raw.text:
            return ParseResult(STATUS_ERRO, diagnostico=raw.diagnostico or "sem conteúdo")

        titulo_pagina = extrair_titulo_pagina(raw.text)
        candidatos: list[float] = []
        m = self._TITLE_CH_RE.search(titulo_pagina)
        if m:
            candidatos.append(float(m.group(1)))

        links = re.findall(r'href="[^"]*?/chapter-([0-9.]+)/?"', raw.text)
        candidatos.extend(float(n) for n in links)

        if not candidatos:
            return ParseResult(STATUS_VAZIA, diagnostico="reconheceu o tema init-manga, mas sem capítulo no título nem links (obra sem lançamento?)")

        maior = max(candidatos)
        maior_fmt = int(maior) if maior.is_integer() else maior
        return ParseResult(
            STATUS_OK, titulo_site=titulo_pagina or None, ultimo_capitulo=maior_fmt, link_capitulo=raw.url,
            tipo_detectado=detectar_tipo(raw.url, raw.text),
        )


# --- A3. madara (tema Madara real) — anubisscans, hazelnade -----------------


class MadaraAdapter(SourceAdapter):
    """
    WordPress + tema Madara real. Fingerprint: `listing-chapters_wrap` ou
    `wp-manga-chapter` ou `class="wp-manga"` no HTML da página da série.

    Confirmado ao vivo: a lista de capítulos NÃO vem no HTML inicial (os
    `wp-manga-chapter` que aparecem ali são só nomes de arquivo CSS/plugin,
    não itens reais). O mecanismo real (lido do JS do tema, `manga-single.js`
    + `script.js`) é um **POST** pra `{url_da_serie}ajax/chapters/?t=1`
    (sem corpo) — não é `admin-ajax.php` com `action=manga_get_chapters`
    como uma leitura mais superficial sugeriria; é a segunda variante que o
    handout já cogitava (`GET /<slug>/ajax/chapters/`), mas com **POST**, e
    sem precisar do `post_id`. Testado com sucesso em anubisscans e
    hazelnade (lista completa numa página só, sem paginação nos casos
    testados).
    """

    id = "madara"
    display_name = "Madara (WordPress, via ajax/chapters/)"
    access_strategy_padrao = ACCESS_HTTP

    def matches(self, url: str) -> bool:
        raw = fetch_http(url)
        if raw.status != "ok" or not raw.text:
            return False
        return "listing-chapters_wrap" in raw.text or "wp-manga-chapter" in raw.text or 'class="wp-manga"' in raw.text

    def fetch(self, url: str, access_strategy: str) -> RawContent:
        ajax_url = url.rstrip("/") + "/ajax/chapters/?t=1"
        fetcher = FETCHERS.get(access_strategy, fetch_http)
        if fetcher is not fetch_http:
            return fetcher(ajax_url)
        try:
            resp = requests.post(
                ajax_url,
                headers={"X-Requested-With": "XMLHttpRequest", "User-Agent": "Mozilla/5.0"},
                timeout=20,
            )
        except requests.RequestException as exc:
            bloqueado = "403" in str(exc) or "cloudflare" in str(exc).lower()
            return RawContent("acesso_bloqueado" if bloqueado else "erro", ajax_url, diagnostico=str(exc))
        if resp.status_code in (403, 503):
            return RawContent("acesso_bloqueado", ajax_url, diagnostico=f"HTTP {resp.status_code}")
        if not resp.ok:
            return RawContent("erro", ajax_url, diagnostico=f"HTTP {resp.status_code}")
        return RawContent("ok", ajax_url, text=resp.text)

    def parse(self, raw: RawContent) -> ParseResult:
        if raw.status == "acesso_bloqueado":
            return ParseResult(STATUS_BLOQUEADO, diagnostico=raw.diagnostico)
        if raw.status != "ok" or not raw.text:
            return ParseResult(STATUS_ERRO, diagnostico=raw.diagnostico or "sem conteúdo")

        entradas = re.findall(r'<a href="([^"]*?/chapter-([0-9.]+)/?)"', raw.text)
        if not entradas:
            return ParseResult(
                STATUS_INVALIDA if "wp-manga-chapter" not in raw.text else STATUS_VAZIA,
                diagnostico="resposta do ajax/chapters/ sem links de capítulo reconhecíveis",
            )

        link, numero_str = max(entradas, key=lambda e: float(e[1]))
        numero = float(numero_str)
        numero_fmt = int(numero) if numero.is_integer() else numero
        # A URL original (não a do ajax) carrega o sinal de tipo (/novel/ vs /manga/).
        url_obra = raw.url.split("/ajax/chapters/")[0] + "/"
        return ParseResult(STATUS_OK, ultimo_capitulo=numero_fmt, link_capitulo=link, tipo_detectado=detectar_tipo(url_obra))


# --- A4. vymanga (Laravel, single-site) -------------------------------------


class VymangaAdapter(SourceAdapter):
    """
    vymanga.net / vymanga.com — mesmo site (Laravel server-rendered, tema
    próprio, `og:site_name` = "VyManga"), mas **não são intercambiáveis** na
    prática: confirmado em produção (GitHub Actions, 2026-07-17) que
    `.com` responde normalmente (chapters extraídos com sucesso em massa)
    enquanto `.net` bate num bloqueio (challenge Cloudflare / 403) — o
    inverso do que o handout presumia ("vymanga.com redireciona pra .net").
    `fetch()` normaliza qualquer URL `.net` pra `.com` antes de buscar.
    """

    id = "vymanga"
    display_name = "VyManga (Laravel, single-site)"
    access_strategy_padrao = ACCESS_HTTP

    def matches(self, url: str) -> bool:
        host = (urlparse(url).hostname or "").lower()
        if host in ("vymanga.net", "vymanga.com", "www.vymanga.net", "www.vymanga.com"):
            return True
        raw = fetch_http(url)
        return raw.status == "ok" and bool(raw.text) and 'og:site_name" content="VyManga"' in raw.text

    def _normalizar_dominio(self, url: str) -> str:
        p = urlparse(url)
        host = (p.hostname or "").lower()
        if host in ("vymanga.net", "www.vymanga.net"):
            return url.replace(p.netloc, "vymanga.com", 1)
        return url

    def fetch(self, url: str, access_strategy: str) -> RawContent:
        return FETCHERS.get(access_strategy, fetch_http)(self._normalizar_dominio(url))

    def parse(self, raw: RawContent) -> ParseResult:
        if raw.status == "acesso_bloqueado":
            return ParseResult(STATUS_BLOQUEADO, diagnostico=raw.diagnostico)
        if raw.status != "ok" or not raw.text:
            return ParseResult(STATUS_ERRO, diagnostico=raw.diagnostico or "sem conteúdo")

        m = re.search(r'class="[^"]*\bdiv-chapter\b[^"]*"[\s\S]*?class="[^"]*\blist\b[^"]*"[\s\S]{0,20000}', raw.text)
        if not m:
            return ParseResult(STATUS_INVALIDA, diagnostico='não achei o bloco ".div-chapter .list" no HTML')

        bloco = m.group(0)
        links = re.findall(r'class="[^"]*list-group-item[^"]*"[^>]*href="([^"]+)"', bloco)
        if not links:
            links = re.findall(r'href="([^"]+)"[^>]*class="[^"]*list-group-item', bloco)
        if not links:
            return ParseResult(STATUS_VAZIA, diagnostico='bloco de capítulos reconhecido, sem links "list-group-item"')

        numeros = []
        for link in links:
            m2 = re.search(r"([0-9]+(?:\.[0-9]+)?)(?:/)?$", link.rstrip("/"))
            if m2:
                numeros.append((float(m2.group(1)), link))
        if not numeros:
            return ParseResult(STATUS_INVALIDA, diagnostico="links de capítulo encontrados, mas sem número reconhecível no final da URL")

        numero, link = max(numeros, key=lambda x: x[0])
        numero_fmt = int(numero) if numero.is_integer() else numero
        return ParseResult(STATUS_OK, ultimo_capitulo=numero_fmt, link_capitulo=link, tipo_detectado=detectar_tipo(raw.url, raw.text))


# --- A5. mangafox / fanfox.net (single-site) --------------------------------


class MangaFoxAdapter(SourceAdapter):
    """
    fanfox.net (MangaFox clássico). Padrão de capítulo `/manga/{slug}/c{N}/`.
    Confirmado ao vivo: plain GET funciona sem Cloudflare challenge neste
    ambiente (a incerteza do handout sobre bloqueio não se confirmou aqui;
    pode variar por IP/ASN do runner — sem indicação de bloqueio, mantém
    `access_strategy=http`; se o GitHub Actions runner apanhar um 403/JS
    challenge, o modo diagnóstico mostra `acesso_bloqueado` e aponta pra
    Fase 2 (curl_cffi antes de proxy, como o handout recomenda).
    """

    id = "mangafox"
    display_name = "MangaFox / FanFox (single-site)"
    access_strategy_padrao = ACCESS_HTTP

    # Ex.: href="/manga/{slug}/c001/1.html" — número vem logo após "/c", pode
    # ter mais segmentos de página depois (não fecha a URL ali).
    _CHAPTER_RE = re.compile(r'href="([^"]*?/manga/[^"/]+/c([0-9]+(?:\.[0-9]+)?)[^"]*)"')

    def matches(self, url: str) -> bool:
        host = (urlparse(url).hostname or "").lower()
        if host in ("fanfox.net", "www.fanfox.net", "mangafox.me", "www.mangafox.me"):
            return True
        raw = fetch_http(url)
        return raw.status == "ok" and bool(raw.text) and self._CHAPTER_RE.search(raw.text) is not None

    def parse(self, raw: RawContent) -> ParseResult:
        if raw.status == "acesso_bloqueado":
            return ParseResult(STATUS_BLOQUEADO, diagnostico=raw.diagnostico)
        if raw.status != "ok" or not raw.text:
            return ParseResult(STATUS_ERRO, diagnostico=raw.diagnostico or "sem conteúdo")

        entradas = self._CHAPTER_RE.findall(raw.text)
        if not entradas:
            return ParseResult(STATUS_VAZIA, diagnostico='reconheceu o site, sem links "/manga/<slug>/c<N>/" (obra sem capítulo?)')

        link, numero_str = max(entradas, key=lambda e: float(e[1]))
        numero = float(numero_str)
        numero_fmt = int(numero) if numero.is_integer() else numero
        return ParseResult(STATUS_OK, ultimo_capitulo=numero_fmt, link_capitulo=link, tipo_detectado="manga")


# --- A-bônus. sakuraze (SPA React puro, API Supabase pública) ---------------


class SakurazeAdapter(SourceAdapter):
    """
    sakuraze.vercel.app — SPA React (Vite) puro: o HTML inicial é só
    `<div id="root"></div>`, zero dados embutidos, plain GET não serve pra
    raspar HTML.

    Resolvido o "A CONFIRMAR" do handout: o bundle JS expõe diretamente uma
    URL de projeto Supabase (`https://hlzjslwrhabsxdskinwd.supabase.co`) e a
    chave `anon` pública (mesmo padrão de app client-side com RLS que este
    projeto usa) — dá pra consultar a API REST (PostgREST) diretamente, sem
    Playwright. Tabelas públicas confirmadas: `novels` (title, slug, type,
    novel_type, ...) e `chapters` (novel_id, chapter_number, ...). Rota do
    frontend pra série é `/<slug>` (raiz, sem prefixo `/novel/`).

    Nota: chave/projeto embutidos no bundle público do site, do mesmo jeito
    que qualquer visitante do navegador já recebe — não é uma credencial
    extraída indevidamente.
    """

    id = "sakuraze"
    display_name = "Sakuraze (SPA React + API Supabase pública)"
    access_strategy_padrao = ACCESS_HTTP

    _SUPABASE_URL = "https://hlzjslwrhabsxdskinwd.supabase.co"
    _ANON_KEY = (
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
        "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsempzbHdyaGFic3hkc2tpbndkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE0ODYyNTEsImV4cCI6MjA3NzA2MjI1MX0."
        "_xpIADB4jDsXIGp92-sFTQW8KAbli-Lr99ggJ8DRyX8"
    )

    def matches(self, url: str) -> bool:
        return (urlparse(url).hostname or "").lower() in ("sakuraze.vercel.app", "www.sakuraze.vercel.app")

    def _slug_da_url(self, url: str) -> str:
        # Pega o ÚLTIMO segmento do path, não o primeiro: URLs reais observadas usam
        # prefixo /novel/<slug> (a rota "/:slug" vista no bundle JS não é a única).
        partes = [p for p in urlparse(url).path.split("/") if p]
        return partes[-1] if partes else ""

    def fetch(self, url: str, access_strategy: str) -> RawContent:
        slug = self._slug_da_url(url)
        if not slug:
            return RawContent("erro", url, diagnostico="URL sem slug de novel reconhecível")
        headers = {"apikey": self._ANON_KEY, "Authorization": f"Bearer {self._ANON_KEY}"}
        try:
            resp_novel = requests.get(
                f"{self._SUPABASE_URL}/rest/v1/novels",
                params={"slug": f"eq.{slug}", "select": "id,title,slug,type,novel_type"},
                headers=headers,
                timeout=15,
            )
            if not resp_novel.ok:
                return RawContent("erro", url, diagnostico=f"REST novels HTTP {resp_novel.status_code}")
            novels = resp_novel.json()
            if not novels:
                return RawContent("ok", url, text=json.dumps({"novel": None, "chapters": []}))
            novel = novels[0]

            resp_chap = requests.get(
                f"{self._SUPABASE_URL}/rest/v1/chapters",
                params={
                    "novel_id": f"eq.{novel['id']}",
                    "select": "chapter_number",
                    "order": "chapter_number.desc",
                    "limit": "1",
                },
                headers=headers,
                timeout=15,
            )
            if not resp_chap.ok:
                return RawContent("erro", url, diagnostico=f"REST chapters HTTP {resp_chap.status_code}")
            chapters = resp_chap.json()
        except requests.RequestException as exc:
            return RawContent("erro", url, diagnostico=str(exc))

        return RawContent("ok", url, text=json.dumps({"novel": novel, "chapters": chapters}))

    def parse(self, raw: RawContent) -> ParseResult:
        if raw.status == "acesso_bloqueado":
            return ParseResult(STATUS_BLOQUEADO, diagnostico=raw.diagnostico)
        if raw.status != "ok" or not raw.text:
            return ParseResult(STATUS_ERRO, diagnostico=raw.diagnostico or "sem conteúdo")

        try:
            dados = json.loads(raw.text)
        except ValueError as exc:
            return ParseResult(STATUS_INVALIDA, diagnostico=f"resposta não é JSON válido: {exc}")

        novel = dados.get("novel")
        if novel is None:
            return ParseResult(STATUS_INVALIDA, diagnostico="slug não encontrado na tabela novels")

        chapters = dados.get("chapters") or []
        if not chapters:
            return ParseResult(STATUS_VAZIA, diagnostico="novel encontrada, sem capítulos publicados ainda")

        numero = chapters[0]["chapter_number"]
        numero_fmt = int(numero) if float(numero).is_integer() else numero
        tipo_campo = (novel.get("novel_type") or novel.get("type") or "").lower()
        tipo_detectado = "novel" if "novel" in tipo_campo or not tipo_campo else detectar_tipo(raw.url)
        return ParseResult(STATUS_OK, titulo_site=novel.get("title"), ultimo_capitulo=numero_fmt, link_capitulo=raw.url, tipo_detectado=tipo_detectado)
