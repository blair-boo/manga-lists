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
import os
import re
import sys
import time
from urllib.parse import urljoin, urlparse
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
from common import host_de_url, http_get
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


# --- A6. magustoon (Astro islands, /series/<slug>/chapter-<N>) ---------------


class MagustoonAdapter(SourceAdapter):
    """
    magustoon.org — frontend Astro (bundle em `/_vcomics/`) sobre o MESMO
    backend SaaS do CmsGenericoAdapter (a API `api.{host}/api/posts` responde
    com a mesma forma `{"posts":[...]}`). Por isso o CmsGenericoAdapter casava
    com o domínio (matches() só checa a API) mas o parse dele falhava sempre:
    o parser do CMS genérico procura o array `\\"chapters\\":[` com aspas
    escapadas por barra (payload RSC do Next.js), enquanto o Astro serializa os
    dados da ilha com entidades HTML (`&quot;chapters&quot;`) e embrulha cada
    valor em `[0, valor]` — formato incompatível. Resultado: as fontes
    magustoon ficavam com `ultimo_capitulo_detectado` NULL indefinidamente.

    Em vez de decodificar o payload da ilha, lê o sinal mais simples e estável
    da página da série: os links `/series/<slug>/chapter-<N>` (o mesmo padrão
    que Madara/ts_theme/mgread usam). A lista renderizada é uma janela dos
    capítulos mais recentes com o mais novo no topo, então o maior N é sempre o
    último lançado. Os links são filtrados pelo slug da própria série (extraído
    da URL) pra não capturar capítulos de séries recomendadas na mesma página.

    Registrado ANTES do CmsGenericoAdapter no REGISTRY pra vencer a detecção
    (os dois reconhecem o domínio pela API compartilhada; só este lê o Astro).
    """

    id = "magustoon"
    display_name = "Magus Toon (Astro, /series/<slug>/chapter-<N>)"
    access_strategy_padrao = ACCESS_HTTP

    def _slug_da_url(self, url: str) -> str | None:
        partes = [p for p in urlparse(url).path.split("/") if p]
        if "series" in partes:
            idx = partes.index("series")
            if idx + 1 < len(partes):
                return partes[idx + 1]
        return None

    def _url_overview(self, url: str) -> str:
        """Normaliza uma URL de leitura (/series/<slug>/chapter-N) pra overview da
        série (/series/<slug>), que embute a lista de capítulos recentes."""
        slug = self._slug_da_url(url)
        if not slug:
            return url
        p = urlparse(url)
        return f"{p.scheme}://{p.netloc}/series/{slug}"

    def matches(self, url: str) -> bool:
        host = (urlparse(url).hostname or "").lower()
        if "magustoon" in host:
            return True
        # Fallback por conteúdo: o bundle Astro do motor fica em /_vcomics/,
        # pra cobrir um domínio-espelho futuro do mesmo site sem hardcode.
        raw = fetch_http(url)
        return raw.status == "ok" and bool(raw.text) and "/_vcomics/" in raw.text

    def fetch(self, url: str, access_strategy: str) -> RawContent:
        return FETCHERS.get(access_strategy, fetch_http)(self._url_overview(url))

    def parse(self, raw: RawContent) -> ParseResult:
        if raw.status == "acesso_bloqueado":
            return ParseResult(STATUS_BLOQUEADO, diagnostico=raw.diagnostico)
        if raw.status != "ok" or not raw.text:
            return ParseResult(STATUS_ERRO, diagnostico=raw.diagnostico or "sem conteúdo")

        slug = self._slug_da_url(raw.url)
        if not slug:
            return ParseResult(STATUS_INVALIDA, diagnostico="URL sem slug de série reconhecível")

        padrao = re.compile(rf'href="(/series/{re.escape(slug)}/chapter-([0-9]+(?:\.[0-9]+)?))"')
        entradas = padrao.findall(raw.text)
        if not entradas:
            return ParseResult(
                STATUS_VAZIA,
                diagnostico="página da série reconhecida, sem links /chapter-<N> do próprio slug (obra sem capítulo?)",
            )

        href, numero_str = max(entradas, key=lambda e: float(e[1]))
        numero = float(numero_str)
        numero_fmt = int(numero) if numero.is_integer() else numero
        p = urlparse(raw.url)
        return ParseResult(
            STATUS_OK,
            ultimo_capitulo=numero_fmt,
            link_capitulo=f"{p.scheme}://{p.netloc}{href}",
            tipo_detectado=detectar_tipo(raw.url, raw.text),
        )


# --- A7. comix (React Query initial-data) -----------------------------------

_COMIX_INITIAL_DATA_RE = re.compile(
    r'<script[^>]+id=["\']initial-data["\'][^>]*>(.*?)</script>',
    re.IGNORECASE | re.DOTALL,
)
_COMIX_HID_RE = re.compile(r"/title/([0-9A-Za-z]+)-")

# Path do endpoint de listagem, usado por catálogo/busca. CONFIRMADO em
# 2026-07-30, não contra o site ao vivo (Cloudflare continua bloqueando com
# um challenge JS real, "Just a moment...", todo GET direto deste ambiente —
# curl incluso, então não é fingerprint de cliente), mas lendo o bundle real
# do app (`env-tiv3b5-C62t0jdR.js`, arquivo servido por comix.to e capturado
# fora deste ambiente): a constante de rota é `W.manga.list = "/manga"`, e o
# client de busca do próprio app chama exatamente essa rota
# (`N.list({keyword:o,limit:12})`, em `main-tiv3b5-D41wynCQ.js`) — confirma
# ao mesmo tempo o path e que busca/catálogo são a mesma função, como o
# handout já indicava. `fetch_http`/`_parece_cloudflare` tratam o bloqueio
# como STATUS_BLOQUEADO (não derruba o run), então o pior caso enquanto o
# challenge não for contornado (browser real / FlareSolverr) é o catálogo
# ficar vazio.
_COMIX_PATH_LISTA = "/api/v1/manga"

# Nunca visto acima de 31 no bundle real (browse=28, home=31, busca=12); 100
# é a aposta do handout pra reduzir o nº de páginas, não um teto confirmado.
# Sem risco funcional se a API cortar silenciosamente: a paginação só confia
# em meta.hasNext, não na contagem pedida.
_COMIX_LIMITE_PAGINA = 100
_COMIX_MAX_PAGINAS = 400  # trava de segurança contra loop infinito
_COMIX_DELAY = 0.5  # segundos entre páginas do catálogo

# Teto de páginas do catálogo POR CUSTO (não segurança): cada página agora é um
# request renderizado na API de scraping (o endpoint JSON exige render pra
# passar o Cloudflare), então varrer o acervo inteiro queima muito crédito. O
# catálogo vem ordenado por `chapter_updated_at desc`, então as primeiras
# páginas já são as obras mais ativas — as que mais interessam pro match.
# Configurável por COMIX_MAX_PAGINAS_CATALOGO (0 = sem teto, varre tudo até
# _COMIX_MAX_PAGINAS). Default 20 páginas = ~2000 títulos mais recentes.
def _max_paginas_catalogo() -> int:
    try:
        v = int(os.environ.get("COMIX_MAX_PAGINAS_CATALOGO", "20"))
    except ValueError:
        v = 20
    if v <= 0:
        return _COMIX_MAX_PAGINAS
    return min(v, _COMIX_MAX_PAGINAS)


def _sem_espacos(s: str) -> str:
    return "".join(s.split())


def _order(criterio: dict) -> dict:
    """
    Serialização dos parâmetros de ordenação. CONFIRMADO em 2026-07-30 pela
    combinação de duas evidências (não por request ao vivo, ver
    `_COMIX_PATH_LISTA`):

    1. O bundle real (`env-tiv3b5-C62t0jdR.js`) cria o client Axios sem
       `paramsSerializer` custom (`_.create({baseURL:"/api/v1",
       withCredentials:!0,timeout:15e3,headers:{...}})`), e `main-*.js` passa
       `order` como objeto JS puro (`order:{chapter_updated_at:"desc"}`,
       várias ocorrências) — nunca `JSON.stringify(order)`. Ou seja, o que
       vai pra URL é o que o serializador PADRÃO do Axios produz.
    2. Lendo o fonte do Axios instalado neste ambiente
       (`axios/lib/helpers/toFormData.js`, `renderKey()`): sem `dots:true`
       explícito (que o app não passa), objeto aninhado vira notação de
       colchetes — `renderKey` monta `parent[child]`, não JSON.stringify.
       Esse comportamento é o do Axios pós-reescrita (>=0.27, a lib de
       `AxiosURLSearchParams` usa `toFormData` por baixo); a suposição
       antiga (JSON.stringify) valia só no serializer legado pré-0.27.

    Variante B (colchetes) é portanto a aposta correta, invertendo a
    suposição inicial (Variante A, JSON.stringify) que este código tinha
    antes de ler o bundle real.
    """
    return {f"order[{k}]": v for k, v in criterio.items()}
    # Variante A (JSON.stringify) — comportamento do serializer LEGADO do
    # Axios (pré-0.27), descartada: o bundle real não usa dots/serializer
    # custom, e a lib instalada (>=0.27) não faz JSON.stringify por padrão
    # pra objeto aninhado em `params`. Mantida comentada só como próxima
    # tentativa se a B, por algum motivo (versão de Axios mais antiga no
    # bundle real do site), não ordenar nada.
    # return {"order": json.dumps(criterio, separators=(",", ":"))}


def _extrair_json(texto: str):
    """
    Parseia o corpo da resposta do endpoint de listagem, tolerante ao formato:

    - JSON cru (caso ideal), ou
    - JSON embrulhado em HTML — que é o que o provider de scraping devolve ao
      renderizar (render=true) um endpoint JSON: o navegador embrulha o JSON
      num `<pre>` (e a página tem `<style>`/`<script>` com chaves em volta).
      Render é obrigatório no comix (o Cloudflare exige JS), então esse
      desembrulho não é evitável. Remove script/style, pega o texto e parseia o
      maior bloco `{...}` balanceado.

    Devolve o objeto (dict/list) ou None.
    """
    texto = (texto or "").strip()
    try:
        return json.loads(texto)
    except ValueError:
        pass
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(texto, "html.parser")
        for tag in soup(["script", "style"]):
            tag.decompose()
        conteudo = soup.get_text()
    except Exception:  # noqa: BLE001 - sem bs4 ou HTML inválido: tenta o texto cru
        conteudo = texto
    inicio = conteudo.find("{")
    fim = conteudo.rfind("}")
    if inicio != -1 and fim > inicio:
        try:
            return json.loads(conteudo[inicio : fim + 1])
        except ValueError:
            pass
    return None


def _desembrulhar_resultado(dados):
    """
    A API do comix responde `{"status":"ok","result":{...}}` — o interceptor
    Axios do app desembrulha pra `.result` (confirmado no bundle). O cliente
    HTTP daqui não desembrulha, então fazemos na mão.
    """
    if isinstance(dados, dict) and dados.get("status") == "ok" and isinstance(dados.get("result"), dict):
        return dados["result"]
    return dados


def _titulos_do_item(it: dict) -> list[str]:
    """
    Todos os títulos casáveis de um item do catálogo: o `title` principal MAIS
    os `altTitles`. A dona pediu explicitamente pra casar também pelos títulos
    alternativos (revertendo a decisão inicial do handout, que usava só
    `title`). Cada título vira um candidato separado no match — assim uma obra
    cujo título principal difere, mas cujo alternativo bate, ainda casa.
    Aceita altTitles como lista de strings ou de objetos {title|name}.
    """
    titulos: list[str] = []

    def add(valor) -> None:
        if isinstance(valor, str):
            s = valor.strip()
            if s and s not in titulos:
                titulos.append(s)

    add(it.get("title"))
    alt = it.get("altTitles")
    if isinstance(alt, list):
        for el in alt:
            if isinstance(el, str):
                add(el)
            elif isinstance(el, dict):
                add(el.get("title") or el.get("name"))
    return titulos


def _pares_titulo_url(itens: list[dict]) -> list[tuple[str, str]]:
    """
    Expande os itens do catálogo em pares (título, url canônica) — um par por
    título casável (principal + alternativos). Vários pares apontando pra mesma
    url são inofensivos: o `update_obras`/`discover_fontes` já escolhe o melhor
    score por slug, então isso só dá mais chances de casar.
    """
    pares: list[tuple[str, str]] = []
    for it in itens:
        url = it.get("url")
        if not url:
            continue
        for titulo in _titulos_do_item(it):
            pares.append((titulo, str(url)))
    return pares


class ComixAdapter(SourceAdapter):
    """
    Comix (comix.to / comix.ws): SPA que embute o cache do React Query no HTML
    inicial, em `<script id="initial-data">`. O registro da obra fica na chave
    `["manga","detail","<hid>"]` e já traz `latestChapter` / `latestChapterUrl`,
    então o estágio de capítulos NÃO chama API: lê o HTML e pronto.

    O `<meta name="cfg">` da página é o sitekey do Turnstile (captcha dos
    formulários de conta), não um token de acesso. Leitura é anônima.

    Catálogo e busca usam o mesmo endpoint de listagem da API (`/api/v1/manga`),
    variando só os parâmetros — confirmado lendo o bundle real do app (ver
    comentário em `_COMIX_PATH_LISTA`): a busca client-side chama
    `N.list({keyword,limit:12})`, a mesma função usada pelo catálogo. Path e
    serialização de `order` (notação de colchetes) também confirmados assim,
    não por request ao vivo — o site segue atrás de um challenge JS do
    Cloudflare pra qualquer acesso direto deste ambiente. O estágio de
    capítulos (`parse()`) não depende de nenhum dos dois.

    Ressalvas registradas (HANDOUT_SCRAPER_COMIX seção 8, sem prova negativa):

    1. Escopo do `latestChapter`. Não há parâmetro de idioma em nenhum filtro
       do site, o que sugere catálogo monolíngue, mas isso não é prova. Se o
       número reportado divergir do que é legível na prática, investigar
       aqui primeiro.
    2. Capítulos bloqueados. Nenhum campo de lock/moeda/paywall aparece nos
       itens de capítulo renderizados pelo app. Mesma observação: divergência
       sistemática de contagem aponta pra cá.

    Ambas se resolvem comparando o `latestChapter` do HTML com uma chamada de
    capítulos ordenada por `{"number": "desc"}` numa obra qualquer, depois que
    o endpoint da seção 5 estiver confirmado.
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

    def _tipo(self, detalhe: dict, raw: RawContent) -> str | None:
        # Site é só de quadrinhos: manga/manhwa/manhua/other caem todos na
        # família 'manga' do projeto (familia_de_tipo); não há novels no catálogo.
        tipo = str(detalhe.get("type") or "").lower()
        if tipo in ("manga", "manhwa", "manhua", "other"):
            return "manga"
        if tipo == "novel":
            return "novel"
        # Tipo desconhecido (campo novo no site): cai na heurística compartilhada.
        return detectar_tipo(raw.url, raw.text or "")

    def _absoluta(self, url_pagina: str, caminho: str | None) -> str | None:
        if not caminho:
            return None
        return urljoin(url_pagina, caminho)

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

    # --- catálogo / busca ---------------------------------------------------

    def _base(self, url: str) -> str:
        return f"https://{host_de_url(url)}"

    def _endpoint_lista(self, url: str) -> str:
        return f"{self._base(url)}{_COMIX_PATH_LISTA}"

    def _consultar(self, url: str, params: dict) -> tuple[list[dict], dict]:
        """
        Uma página do endpoint de listagem: (items, meta). Erros viram ([], {})
        — não é exceção (listar_catalogo/buscar vazios não devem derrubar a run
        — ver update_obras.py), mas imprime o motivo, senão "0 títulos no
        catálogo" fica indistinguível de "site bloqueou o acesso" (ex.:
        challenge do Cloudflare, ver _COMIX_PATH_LISTA).
        """
        try:
            resp = http_get(self._endpoint_lista(url), params=params)
            resp.raise_for_status()
        except requests.RequestException as exc:
            print(f"  comix: falha ao consultar {self._endpoint_lista(url)}: {exc}", file=sys.stderr)
            return [], {}
        dados = _desembrulhar_resultado(_extrair_json(resp.text))
        if not isinstance(dados, dict):
            print(
                f"  comix: resposta não parseou como JSON de {self._endpoint_lista(url)}: {resp.text[:200]!r}",
                file=sys.stderr,
            )
            return [], {}
        itens = dados.get("items")
        meta = dados.get("meta")
        return (itens if isinstance(itens, list) else []), (meta if isinstance(meta, dict) else {})

    def listar_catalogo(self, url: str) -> list[tuple[str, str]]:
        """(título, url relativa) de todo o catálogo, paginando por meta.hasNext.
        Emite um par por título casável (principal + alternativos) de cada
        item — ver _pares_titulo_url / _titulos_do_item."""
        resultado: list[tuple[str, str]] = []
        max_paginas = _max_paginas_catalogo()
        pagina = 1
        while pagina <= max_paginas:
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
            resultado.extend(_pares_titulo_url(itens))
            if not meta.get("hasNext"):
                break
            pagina += 1
            time.sleep(_COMIX_DELAY)
        return resultado

    def buscar(self, url: str, titulo: str) -> list[tuple[str, str]]:
        # {"keyword": ..., "limit": 12}, sem `order`: é exatamente a chamada
        # que o diálogo de busca do próprio app faz (N.list({keyword,limit:12})
        # em main-tiv3b5-D41wynCQ.js) — sem parâmetro de ordenação, o servidor
        # decide (presumivelmente já por relevância pra busca por keyword).
        # Casa por título principal E alternativos (ver _pares_titulo_url).
        itens, _ = self._consultar(url, {"keyword": titulo, "limit": 12})
        return _pares_titulo_url(itens)

    def url_da_fonte(self, url: str, slug: str) -> str:
        # `slug` aqui é a URL canônica relativa que a API já devolve pronta.
        return urljoin(self._base(url) + "/", slug.lstrip("/"))
