# Bookmarklet de importação do Novel Updates

Mesmo mecanismo do bookmarklet do comix.to (`docs/EXTENSAO_COMIX.md`), com uma
única diferença no destino do link: aqui a URL da série **não** vira fonte, e sim
o campo `novelupdates_url` da obra. O resto do fluxo de importação (`/importar`,
fragmento `#d=<payload>`, conferência campo a campo) é idêntico.

## Por que bookmarklet, e não fetch pela URL

A tela `/importar` tem um campo "Fetch by URL" que só funciona pro comix.to
(Edge Function `comix-fetch`). Pro Novel Updates esse caminho não existe: o
Cloudflare do NU devolve 403 para requisições vindas de servidor/datacenter
(confirmado pela sonda do scraper, `scraper/probe_novelupdates.py`, e pelos
comentários em `scraper/novelupdates.py`). As páginas de série são servidas
normalmente **dentro do navegador da usuária** (IP residencial), então o
bookmarklet lê a página ali e manda o resultado pronto pro PWA.

## O que o payload carrega

O bookmarklet monta o mesmo objeto `ComixObra` de `src/lib/comix.ts`, marcado com
`origem: 'novelupdates'`. A tela `/importar` usa esse campo pra decidir onde
gravar o link:

- `origem` ausente ou `'comix'`: a `url` é adicionada como **fonte** da obra.
- `origem: 'novelupdates'`: a `url` é gravada em **`novelupdates_url`** (campo,
  não fonte), e espelhada na contraparte vinculada manga<->novel (via
  `updateObra`/`salvarCamposObra`, `CAMPOS_ESPELHADOS` em `src/db/repo.ts`).

Campos lidos da página de série (todos melhor-esforço, degradam pra vazio se o
NU mudar o DOM):

| Campo do app          | Origem no DOM do Novel Updates                         |
| --------------------- | ------------------------------------------------------ |
| `titulo`              | `<meta property="og:title">` (cai pra `.seriestitlenu`) |
| `url`                 | `<meta property="og:url">`                             |
| `capaUrl`             | `<meta property="og:image">` (cai pra `.seriesimg img`) |
| `titulosAlternativos` | `#editassociated` (Associated Names, separados por `<br>`) |
| `statusPublicacao`    | `#editstatus` (Status in COO), mapeado por heurística  |
| `autores`             | `#showauthors`                                         |
| `artistas`            | `#showartists`                                         |
| `generos`             | `#seriesgenre`                                         |
| `tags`                | `#showtags`                                            |
| `tipo`                | fixo em `Novel` (o NU só hospeda novels)               |

`og:title`, `og:url`, `og:image` e `#editassociated` são o esqueleto confiável
(os mesmos que o scraper Python já usa). Autor/artista/gênero/tag dependem dos
IDs acima do NU; se algum sumir, aquele campo chega vazio e a importação segue.

Mapeamento de status (Status in COO contém texto livre tipo "120 Chapters
(Completed)"): `complet*` -> `Completed`, `hiatus` -> `Hiatus`, `ongoing` ->
`Ongoing`, `cancel*/discontinu*/drop*` -> `Canceled`. Sem match, o valor bruto
aparece entre parênteses na tela, igual ao comix.

## Capa

O bookmarklet tenta buscar a capa (`og:image`) e embutir como `capaBase64`
(mesma técnica do comix). Se o host da imagem (ex.: `cdn.novelupdates.com`)
bloquear a leitura dos bytes por CORS, o `fetch` falha e o payload segue só com
`capaUrl`: a tela mostra a imagem por `<img>` normal. Quando até o `<img>`
falha, a seção "Cover" oferece o seletor manual de arquivo (botão direito na
capa do NU -> salvar imagem -> escolher o arquivo), igual ao fluxo do comix.

## Fonte legível (pra regenerar a versão minificada quando o DOM do NU mudar)

```js
(async function(){
  try {
    function meta(p){ var m=document.querySelector('meta[property="'+p+'"]'); return m&&m.content?m.content.trim():null; }
    function texto(el){ return el?el.textContent.trim():''; }
    function linksDe(id){ var el=document.getElementById(id); if(!el) return []; var out=[]; el.querySelectorAll('a').forEach(function(a){ var t=a.textContent.trim(); if(t) out.push(t); }); return out; }

    var ogUrl = meta('og:url') || location.href.split('#')[0].split('?')[0];
    var titulo = meta('og:title') || texto(document.querySelector('.seriestitlenu'));
    if (!titulo || !/\/series\//i.test(ogUrl)) { alert('Nao achei uma pagina de serie do Novel Updates. Abra uma pagina /series/... e tente de novo.'); return; }

    var slug = (ogUrl.match(/\/series\/([^\/?#]+)/i) || [])[1] || titulo;

    function norm(t){ return (t||'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }

    var alts = [];
    var assoc = document.getElementById('editassociated');
    if (assoc) {
      assoc.innerHTML.split(/<br\s*\/?>/i).forEach(function(parte){
        var tmp = document.createElement('div'); tmp.innerHTML = parte;
        var s = tmp.textContent.trim(); if (s) alts.push(s);
      });
    }
    var vistos = {}; vistos[norm(titulo)] = true;
    var altsLimpos = [];
    alts.forEach(function(t){ var n = norm(t); if (t && n && !vistos[n]) { vistos[n] = true; altsLimpos.push(t); } });

    var statusTxt = texto(document.getElementById('editstatus'));
    var status = /complet/i.test(statusTxt) ? 'Completed'
      : /hiatus/i.test(statusTxt) ? 'Hiatus'
      : /ongoing/i.test(statusTxt) ? 'Ongoing'
      : /cancel|discontinu|drop/i.test(statusTxt) ? 'Canceled'
      : null;

    var capaUrl = meta('og:image');
    if (!capaUrl) { var img = document.querySelector('.seriesimg img'); capaUrl = img ? img.src : null; }

    var obra = {
      origem: 'novelupdates',
      hid: slug,
      titulo: titulo,
      titulosAlternativos: altsLimpos,
      tipo: 'Novel',
      tipoBruto: null,
      statusPublicacao: status,
      statusPublicacaoBruto: status ? null : (statusTxt || null),
      contentRating: null,
      capaUrl: capaUrl,
      ultimoCapitulo: null,
      url: ogUrl,
      autores: linksDe('showauthors'),
      artistas: linksDe('showartists'),
      generos: linksDe('seriesgenre'),
      tags: linksDe('showtags'),
      links: { anilist_url: null, myanimelist_url: null, mangaupdates_url: null, mangadex_url: null, mangabaka_url: null }
    };

    if (capaUrl) {
      try {
        var resp = await fetch(capaUrl);
        if (resp.ok) {
          var blob = await resp.blob();
          obra.capaBase64 = await new Promise(function(res){ var fr = new FileReader(); fr.onloadend = function(){ res(fr.result); }; fr.readAsDataURL(blob); });
        }
      } catch (fe) { /* segue sem capaBase64 */ }
    }

    var json = JSON.stringify(obra);
    var bytes = new TextEncoder().encode(json);
    var bin = ''; bytes.forEach(function(b){ bin += String.fromCharCode(b); });
    var b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    location.href = 'https://blair-boo.github.io/manga-lists/importar#d=' + b64;
  } catch (e) {
    alert('Erro no bookmarklet: ' + (e && e.message || e));
  }
})();
```

## Versão minificada em uma linha só (colar no campo "URL" de um favorito)

O navegador faz o percent-decode do URI `javascript:` antes de executar, então os
`%20` voltam a ser espaços na hora de rodar (mesma técnica do bookmarklet do
comix). Cole exatamente como está:

```
javascript:(()=>{(async%20function(){try{let%20r=function(e){var%20t=document.querySelector('meta[property="'+e+'"]');return%20t&&t.content?t.content.trim():null},s=function(e){return%20e?e.textContent.trim():""},i=function(e){var%20t=document.getElementById(e);if(!t)return[];var%20o=[];return%20t.querySelectorAll("a").forEach(function(k){var%20w=k.textContent.trim();w&&o.push(w)}),o},m=function(e){return(e||"").normalize("NFKD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"%20").trim()};var%20N=r,q=s,A=i,H=m,u=r("og:url")||location.href.split("#")[0].split("?")[0],l=r("og:title")||s(document.querySelector(".seriestitlenu"));if(!l||!/\/series\//i.test(u)){alert("Nao%20achei%20uma%20pagina%20de%20serie%20do%20Novel%20Updates.%20Abra%20uma%20pagina%20/series/...%20e%20tente%20de%20novo.");return}var%20E=(u.match(/\/series\/([^\/?#]+)/i)||[])[1]||l,d=[],f=document.getElementById("editassociated");f&&f.innerHTML.split(/<br\s*\/?>/i).forEach(function(e){var%20t=document.createElement("div");t.innerHTML=e;var%20o=t.textContent.trim();o&&d.push(o)});var%20c={};c[m(l)]=!0;var%20g=[];d.forEach(function(e){var%20t=m(e);e&&t&&!c[t]&&(c[t]=!0,g.push(e))});var%20n=s(document.getElementById("editstatus")),v=/complet/i.test(n)?"Completed":/hiatus/i.test(n)?"Hiatus":/ongoing/i.test(n)?"Ongoing":/cancel|discontinu|drop/i.test(n)?"Canceled":null,a=r("og:image");if(!a){var%20h=document.querySelector(".seriesimg%20img");a=h?h.src:null}var%20p={origem:"novelupdates",hid:E,titulo:l,titulosAlternativos:g,tipo:"Novel",tipoBruto:null,statusPublicacao:v,statusPublicacaoBruto:v?null:n||null,contentRating:null,capaUrl:a,ultimoCapitulo:null,url:u,autores:i("showauthors"),artistas:i("showartists"),generos:i("seriesgenre"),tags:i("showtags"),links:{anilist_url:null,myanimelist_url:null,mangaupdates_url:null,mangadex_url:null,mangabaka_url:null}};if(a)try{var%20y=await%20fetch(a);if(y.ok){var%20C=await%20y.blob();p.capaBase64=await%20new%20Promise(function(e){var%20t=new%20FileReader;t.onloadend=function(){e(t.result)},t.readAsDataURL(C)})}}catch{}var%20B=JSON.stringify(p),S=new%20TextEncoder().encode(B),b="";S.forEach(function(e){b+=String.fromCharCode(e)});var%20_=btoa(b).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");location.href="https://blair-boo.github.io/manga-lists/importar#d="+_}catch(r){alert("Erro%20no%20bookmarklet:%20"+(r&&r.message||r))}})();})();
```

URL do PWA hardcoded acima: `https://blair-boo.github.io/manga-lists/`. Se mudar,
regenerar a versão minificada com a URL nova.

**Instalar no Safari iOS:** adicionar qualquer página aos favoritos, editar esse
favorito (nome: "Import Novel Updates"; URL: colar o código acima por inteiro).
Depois, numa página de série do NU (`.../series/...`), abrir o favorito.

## Regenerar a versão minificada

A partir da fonte legível acima (salva num arquivo `src.js`):

```
npx esbuild src.js --minify --format=iife
```

Depois, no resultado: trocar o range literal de marcas combinantes por
`[̀-ͯ]` e substituir espaços por `%20` para o URI `javascript:`. Se
`src/lib/comix.ts` mudar a forma do `ComixObra`, conferir se os campos acima
continuam batendo.
