# Extensão de navegador / bookmarklet — importação do comix.to

Esboço, não implementação (Handout de importação comix.to, Bloco G). A
extensão em si fica num repositório separado; o que precisa existir *aqui*
pra ela funcionar já está pronto:

- `normalizarComix`, `codificarPayload`/`decodificarPayload` em `src/lib/comix.ts`
  (puro, sem Dexie/Supabase/React — copiável tal e qual pro repositório da extensão).
- A rota `/importar` já lê o fragmento `#d=<payload>` (ver `ImportarComixPage.tsx`),
  limpando a URL logo depois de ler.

## Content script (extensão)

Fluxo, na página de título do comix.to:

1. Ler o `<script type="application/json" id="initial-data">` do DOM (o
   mesmo bloco que `extrairDetalheDoHtml` lê a partir de HTML bruto — na
   extensão já se está *na* página, então dá pra ler o DOM direto em vez de
   buscar HTML por fetch).
2. `normalizarComix(detalhe)` → `ComixObra`.
3. `codificarPayload(obra)` → string base64url.
4. Abrir/navegar para `<url-do-pwa>/importar#d=<payload>` (nova aba, ou a
   mesma se a extensão rodar como popup com um botão "Import").

Sem chamada de rede própria: a extensão só lê o que a página já carregou.
Não depende da Edge Function `comix-fetch` (que existe pra cobrir o caso em
que o navegador não pode buscar a página — ex.: colar a URL direto no PWA no
celular).

## Bookmarklet (alternativa sem extensão, ex.: Safari iOS)

Mesmo código, empacotado como `javascript:` URI de um único bookmark. O
corpo embute uma cópia inline de `normalizarComix`/`codificarPayload`
(mesma lógica de `src/lib/comix.ts`, minificada à mão — um bookmarklet não
pode `import` módulo nenhum). **Se `src/lib/comix.ts` mudar, regenerar esta
cópia**, pra não divergir.

**Por que isso passou a ser necessário, não só "esboço para o futuro":** em
produção, `comix.to` devolveu 403 (bloqueio do Cloudflare) para as
requisições vindas do servidor da Edge Function `comix-fetch` (confirmado
pelos logs do projeto e por uma chamada direta à função em 2026-08-04),
mesmo a leitura anônima funcionando normalmente num navegador comum. Esse
era exatamente o cenário previsto na pergunta de acompanhamento do handout
original ("se a Edge Function levar 403 do Cloudflare em produção... o
caminho passa a ser a extensão ou o bookmarklet"). O bookmarklet abaixo lê a
página no navegador da própria usuária (IP não bloqueado), então funciona
mesmo com a Edge Function bloqueada.

Fonte (não minificada, pra manter legível e fácil de regenerar):

```js
(function(){
  try {
    var s = document.getElementById('initial-data');
    if (!s) { alert('initial-data não encontrado nesta página. Você está numa página de título do comix.to?'); return; }
    var dados = JSON.parse(s.textContent);
    var hid = dados.manga && dados.manga.hid;
    var d = dados.queries && dados.queries['["manga","detail","' + hid + '"]'];
    if (!d || !d.hid || !d.title || !d.url) { alert('Não consegui achar o detalhe da obra nesta página.'); return; }

    var MAPA_TIPO = { manga: 'Manga', manhwa: 'Manhwa', manhua: 'Manhua' };
    var MAPA_STATUS = { releasing: 'Ongoing', finished: 'Completed', on_hiatus: 'Hiatus', discontinued: 'Canceled' };

    function normTitulo(t) {
      return (t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }

    var altBrutos = Array.isArray(d.altTitles) ? d.altTitles : [];
    var vistos = {}; vistos[normTitulo(d.title)] = true;
    var alts = [];
    for (var i = 0; i < altBrutos.length; i++) {
      var t = (altBrutos[i] || '').trim();
      var n = normTitulo(t);
      if (!t || !n || vistos[n]) continue;
      vistos[n] = true; alts.push(t);
    }

    function extrair(lista) {
      var out = [];
      (lista || []).forEach(function(x) { var t = (x && x.title || '').trim(); if (t) out.push(t); });
      return out;
    }

    var url = /^https?:\/\//i.test(d.url) ? d.url : ('https://comix.to' + (d.url.charAt(0) === '/' ? d.url : '/' + d.url));
    var links = d.links || {};
    var tipo = d.type ? (MAPA_TIPO[d.type.toLowerCase()] || null) : null;
    var status = d.status ? (MAPA_STATUS[d.status.toLowerCase()] || null) : null;

    var obra = {
      hid: d.hid,
      titulo: d.title,
      titulosAlternativos: alts,
      tipo: tipo,
      tipoBruto: tipo ? null : (d.type || null),
      statusPublicacao: status,
      statusPublicacaoBruto: status ? null : (d.status || null),
      contentRating: d.contentRating || null,
      capaUrl: (d.poster && (d.poster.large || d.poster.medium)) || null,
      ultimoCapitulo: d.latestChapter ? d.latestChapter : null,
      url: url,
      autores: extrair(d.authors),
      artistas: extrair(d.artists),
      generos: extrair(d.genres),
      tags: extrair(d.tags),
      links: {
        anilist_url: links.al || null,
        myanimelist_url: links.mal || null,
        mangaupdates_url: links.mu || null,
        mangadex_url: links.md || null,
        mangabaka_url: links.mb || null
      }
    };

    var json = JSON.stringify(obra);
    var bytes = new TextEncoder().encode(json);
    var bin = '';
    bytes.forEach(function(b) { bin += String.fromCharCode(b); });
    var b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    location.href = 'https://blair-boo.github.io/manga-lists/importar#d=' + b64;
  } catch (e) {
    alert('Erro no bookmarklet: ' + (e && e.message || e));
  }
})();
```

Versão minificada em uma linha só (pronta pra colar no campo "URL" de um
favorito, prefixada com `javascript:`):

```
javascript:(function(){try{let t=function(l){return(l||"").normalize("NFKD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()},e=function(l){var f=[];return(l||[]).forEach(function(C){var b=(C&&C.title||"").trim();b&&f.push(b)}),f};var c=document.getElementById("initial-data");if(!c){alert("initial-data n\xE3o encontrado nesta p\xE1gina. Voc\xEA est\xE1 numa p\xE1gina de t\xEDtulo do comix.to?");return}var n=JSON.parse(c.textContent),y=n.manga&&n.manga.hid,a=n.queries&&n.queries['["manga","detail","'+y+'"]'];if(!a||!a.hid||!a.title||!a.url){alert("N\xE3o consegui achar o detalhe da obra nesta p\xE1gina.");return}var _={manga:"Manga",manhwa:"Manhwa",manhua:"Manhua"},w={releasing:"Ongoing",finished:"Completed",on_hiatus:"Hiatus",discontinued:"Canceled"},g=Array.isArray(a.altTitles)?a.altTitles:[],u={};u[t(a.title)]=!0;for(var m=[],i=0;i<g.length;i++){var o=(g[i]||"").trim(),s=t(o);!o||!s||u[s]||(u[s]=!0,m.push(o))}var E=/^https?:\/\//i.test(a.url)?a.url:"https://comix.to"+(a.url.charAt(0)==="/"?a.url:"/"+a.url),r=a.links||{},h=a.type&&_[a.type.toLowerCase()]||null,p=a.status&&w[a.status.toLowerCase()]||null,x={hid:a.hid,titulo:a.title,titulosAlternativos:m,tipo:h,tipoBruto:h?null:a.type||null,statusPublicacao:p,statusPublicacaoBruto:p?null:a.status||null,contentRating:a.contentRating||null,capaUrl:a.poster&&(a.poster.large||a.poster.medium)||null,ultimoCapitulo:a.latestChapter?a.latestChapter:null,url:E,autores:e(a.authors),artistas:e(a.artists),generos:e(a.genres),tags:e(a.tags),links:{anilist_url:r.al||null,myanimelist_url:r.mal||null,mangaupdates_url:r.mu||null,mangadex_url:r.md||null,mangabaka_url:r.mb||null}},A=JSON.stringify(x),N=new TextEncoder().encode(A),v="";N.forEach(function(l){v+=String.fromCharCode(l)});var L=btoa(v).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");location.href="https://blair-boo.github.io/manga-lists/importar#d="+L}catch(t){alert("Erro no bookmarklet: "+(t&&t.message||t))}})();
```

URL do PWA hardcoded acima: `https://blair-boo.github.io/manga-lists/`
(convenção padrão do GitHub Pages para este repositório — sem CNAME
customizado). Se isso mudar, regenerar a versão minificada com a URL nova.

**Instalar no Safari iOS:** adicionar qualquer página aos favoritos, editar
esse favorito (nome: "Import comix.to"; URL: colar o código acima por
inteiro). Depois, numa página de título do comix.to, abrir o favorito.

## Fora de escopo aqui

- Manifest/permissões da extensão, ícone, popup UI — ficam no repositório da
  extensão quando ela for criada.
- Publicação em loja de extensões.
