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

**Capa: por que o fetch automático não é confiável.** A primeira hipótese foi
"hotlink protection por `Referer` externo" — dava pra imaginar que buscar a
imagem *ainda dentro* de `comix.to` (Referer aceito) resolveria. Não resolve:
confirmado em produção (console do navegador, na própria página do comix.to)
que `fetch('https://static.comix.to/...')` quebra com
`net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin` (403) mesmo rodando ali. Isso é
`Cross-Origin-Resource-Policy` (`static.comix.to` manda `same-origin`), não
Referer — e `comix.to` e `static.comix.to` são origens diferentes (subdomínios
diferentes), então nenhum `fetch()`/XHR entre eles passa, não importa de onde
o script roda. Um `<img>` comum funciona (exibir uma imagem cross-origin não
exige CORS/CORP), mas *ler os bytes* dela via JS — `fetch()`, ou
`canvas.toDataURL()` a partir do próprio `<img>` — exige, e não tem contorno
client-side sem o servidor liberar via CORS.

O bookmarklet ainda tenta o fetch-e-embute-como-`capaBase64` (best-effort,
dentro de `try/catch` — se `static.comix.to` algum dia liberar CORS pra esse
endpoint, volta a funcionar sozinho, de graça). Mas o caminho real pra capa
funcionar hoje é o **fallback manual** em `/importar`: quando o `<img>`
automático (via `capaBase64` ou `capaUrl`) falha (`onError`), a seção "Cover"
mostra um seletor de arquivo — a usuária salva a imagem manualmente (botão
direito no comix.to → salvar imagem) e escolhe o arquivo ali (ver
`capaManual`/`capaAutoFalhou` em `ImportarComixPage.tsx`).

Fonte (não minificada, pra manter legível e fácil de regenerar):

```js
(async function(){
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
    var capaUrl = (d.poster && (d.poster.large || d.poster.medium)) || null;

    var obra = {
      hid: d.hid,
      titulo: d.title,
      titulosAlternativos: alts,
      tipo: tipo,
      tipoBruto: tipo ? null : (d.type || null),
      statusPublicacao: status,
      statusPublicacaoBruto: status ? null : (d.status || null),
      contentRating: d.contentRating || null,
      capaUrl: capaUrl,
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

    // Busca a capa ainda aqui, em comix.to (Referer aceito), e embute como
    // data URL — se falhar (rede, formato inesperado), segue sem capaBase64
    // e a página de importação cai pro fetch direto de capaUrl.
    if (capaUrl) {
      try {
        var resp = await fetch(capaUrl);
        if (resp.ok) {
          var blob = await resp.blob();
          obra.capaBase64 = await new Promise(function(resolve) {
            var leitor = new FileReader();
            leitor.onloadend = function() { resolve(leitor.result); };
            leitor.readAsDataURL(blob);
          });
        }
      } catch (fetchErr) { /* segue sem capaBase64 */ }
    }

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
javascript:(async%20function(){try{var%20s=document.getElementById('initial-data');if(!s){alert('initial-data%20n\xE3o%20encontrado%20nesta%20p\xE1gina.%20Voc\xEA%20est\xE1%20numa%20p\xE1gina%20de%20t\xEDtulo%20do%20comix.to?');return}var%20n=JSON.parse(s.textContent),y=n.manga&&n.manga.hid,a=n.queries&&n.queries['["manga","detail","'+y+'"]'];if(!a||!a.hid||!a.title||!a.url){alert('N\xE3o%20consegui%20achar%20o%20detalhe%20da%20obra%20nesta%20p\xE1gina.');return}function%20T(l){return(l||'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'%20').trim()}function%20E(l){var%20f=[];(l||[]).forEach(function(C){var%20b=(C&&C.title||'').trim();b&&f.push(b)});return%20f}var%20_={manga:'Manga',manhwa:'Manhwa',manhua:'Manhua'},w={releasing:'Ongoing',finished:'Completed',on_hiatus:'Hiatus',discontinued:'Canceled'},g=Array.isArray(a.altTitles)?a.altTitles:[],u={};u[T(a.title)]=!0;var%20m=[],i,o,sl;for(i=0;i<g.length;i++){o=(g[i]||'').trim();sl=T(o);if(!o||!sl||u[sl])continue;u[sl]=!0;m.push(o)}var%20eu=/^https?:\/\//i.test(a.url)?a.url:'https://comix.to'+(a.url.charAt(0)==='/'?a.url:'/'+a.url),r=a.links||{},h=a.type&&_[a.type.toLowerCase()]||null,p=a.status&&w[a.status.toLowerCase()]||null,capaUrl=a.poster&&(a.poster.large||a.poster.medium)||null,x={hid:a.hid,titulo:a.title,titulosAlternativos:m,tipo:h,tipoBruto:h?null:a.type||null,statusPublicacao:p,statusPublicacaoBruto:p?null:a.status||null,contentRating:a.contentRating||null,capaUrl:capaUrl,ultimoCapitulo:a.latestChapter?a.latestChapter:null,url:eu,autores:E(a.authors),artistas:E(a.artists),generos:E(a.genres),tags:E(a.tags),links:{anilist_url:r.al||null,myanimelist_url:r.mal||null,mangaupdates_url:r.mu||null,mangadex_url:r.md||null,mangabaka_url:r.mb||null}};if(capaUrl){try{var%20resp=await%20fetch(capaUrl);if(resp.ok){var%20bl=await%20resp.blob();x.capaBase64=await%20new%20Promise(function(res){var%20fr=new%20FileReader();fr.onloadend=function(){res(fr.result)};fr.readAsDataURL(bl)})}}catch(fe){}}var%20A=JSON.stringify(x),N=new%20TextEncoder().encode(A),v='';N.forEach(function(l){v+=String.fromCharCode(l)});var%20L=btoa(v).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');location.href='https://blair-boo.github.io/manga-lists/importar#d='+L}catch(err){alert('Erro%20no%20bookmarklet:%20'+(err&&err.message||err))}})();
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
