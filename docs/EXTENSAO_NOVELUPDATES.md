# Bookmarklet de importação do Novel Updates

Bookmarklet próprio do Novel Updates, separado do comix.to. Ele lê a página de
série no navegador da usuária (o Cloudflare do NU devolve 403 para IP de
servidor, confirmado em `scraper/probe_novelupdates.py`), monta um payload e
abre a rota `/importar-novelupdates#d=<payload>`, atendida por
`src/pages/ImportarNovelUpdatesPage.tsx`.

Peças no app (nenhuma compartilhada com o comix):

- `src/lib/novelupdatesImport.ts`: tipo `NovelImportada`, `codificarNovel`/
  `decodificarNovel`, e a lógica de alvo (`acharAlvoInicial`, `planoDoAlvo`).
- `src/pages/ImportarNovelUpdatesPage.tsx`: a tela de conferência e importação.
- Rota `/importar-novelupdates` em `src/router.tsx`.

## O que a tela faz com o link e o vínculo

O destino do link não é uma fonte: a URL da série vai para o campo
`novelupdates_url` da obra. E, pelo que a dona pediu, a tela decide o alvo assim
(tudo trocável à mão por um campo de busca de obra):

- **Obra nova:** nenhuma obra casa por título. Cria uma Novel nova e solta.
- **Já existe como Novel:** casa com uma Novel. Atualiza essa obra e grava o
  `novelupdates_url`.
- **Já existe como mangá e semelhantes** (Manga/Manhwa/Manhua): cria a Novel como
  **obra correspondente** (contraparte manga<->novel) ligada ao mangá. Se o mangá
  já tiver uma Novel vinculada, atualiza a vinculada em vez de criar outra.

A seção "Target" mostra qual obra ficou escolhida e o que vai acontecer, com um
campo pra trocar o alvo ou limpar (importar solta). Depois da importação é só
abrir a obra: a tela da obra tem "Corresponding work" (conferir, trocar,
desvincular) e o link do Novel Updates (editar, remover).

O `novelupdates_url` é espelhado na contraparte vinculada (`CAMPOS_ESPELHADOS`
em `src/db/repo.ts`), igual ao que o scraper já faz.

## Campos lidos da página de série (melhor esforço)

| Campo do app          | Origem no DOM do Novel Updates                          |
| --------------------- | ------------------------------------------------------- |
| `titulo`              | `<meta property="og:title">` (cai pra `.seriestitlenu`) |
| `url`                 | `<meta property="og:url">`                              |
| `capaUrl`             | `<meta property="og:image">` (cai pra `.seriesimg img`) |
| `titulosAlternativos` | `#editassociated` (Associated Names, separados por `<br>`) |
| `statusPublicacao`    | `#editstatus` (Status in COO), mapeado por heurística   |
| `autores`             | `#showauthors`                                          |
| `artistas`            | `#showartists`                                          |
| `generos`             | `#seriesgenre`                                          |
| `tags`                | `#showtags`                                             |

O tipo da obra é sempre `Novel` (o NU só hospeda novels). `og:title`, `og:url`,
`og:image` e `#editassociated` são o esqueleto confiável (os mesmos que o scraper
Python usa). Autor/artista/gênero/tag dependem dos IDs acima; se algum sumir,
aquele campo chega vazio e a importação segue.

Mapeamento de status (o "Status in COO" vem como texto livre, ex.: "120 Chapters
(Completed)"): `complet*` vira `Completed`, `hiatus` vira `Hiatus`, `ongoing`
vira `Ongoing`, `cancel*/discontinu*/drop*` vira `Canceled`. Sem match, o valor
bruto aparece entre parênteses na tela.

## Capa

O bookmarklet tenta embutir a capa (`og:image`) como `capaBase64`. Se o host da
imagem bloquear a leitura dos bytes por CORS, o payload segue só com `capaUrl` e
a tela mostra por `<img>` normal; quando até o `<img>` falha, a seção "Cover"
oferece o seletor manual de arquivo (botão direito na capa do NU, salvar imagem,
escolher o arquivo).

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

    var novel = {
      slug: slug,
      titulo: titulo,
      titulosAlternativos: altsLimpos,
      statusPublicacao: status,
      statusPublicacaoBruto: status ? null : (statusTxt || null),
      capaUrl: capaUrl,
      url: ogUrl,
      autores: linksDe('showauthors'),
      artistas: linksDe('showartists'),
      generos: linksDe('seriesgenre'),
      tags: linksDe('showtags')
    };

    if (capaUrl) {
      try {
        var resp = await fetch(capaUrl);
        if (resp.ok) {
          var blob = await resp.blob();
          novel.capaBase64 = await new Promise(function(res){ var fr = new FileReader(); fr.onloadend = function(){ res(fr.result); }; fr.readAsDataURL(blob); });
        }
      } catch (fe) { /* segue sem capaBase64 */ }
    }

    var json = JSON.stringify(novel);
    var bytes = new TextEncoder().encode(json);
    var bin = ''; bytes.forEach(function(b){ bin += String.fromCharCode(b); });
    var b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    location.href = 'https://blair-boo.github.io/manga-lists/importar-novelupdates#d=' + b64;
  } catch (e) {
    alert('Erro no bookmarklet: ' + (e && e.message || e));
  }
})();
```

## Versão minificada em uma linha só (colar no campo "URL" de um favorito)

O navegador faz o percent-decode do URI `javascript:` antes de executar, então os
`%20` voltam a ser espaços na hora de rodar. Cole exatamente como está:

```
javascript:(()=>{(async%20function(){try{let%20r=function(e){var%20t=document.querySelector('meta[property="'+e+'"]');return%20t&&t.content?t.content.trim():null},l=function(e){return%20e?e.textContent.trim():""},i=function(e){var%20t=document.getElementById(e);if(!t)return[];var%20o=[];return%20t.querySelectorAll("a").forEach(function(A){var%20w=A.textContent.trim();w&&o.push(w)}),o},m=function(e){return(e||"").normalize("NFKD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"%20").trim()};var%20N=r,k=l,H=i,I=m,u=r("og:url")||location.href.split("#")[0].split("?")[0],c=r("og:title")||l(document.querySelector(".seriestitlenu"));if(!c||!/\/series\//i.test(u)){alert("Nao%20achei%20uma%20pagina%20de%20serie%20do%20Novel%20Updates.%20Abra%20uma%20pagina%20/series/...%20e%20tente%20de%20novo.");return}var%20E=(u.match(/\/series\/([^\/?#]+)/i)||[])[1]||c,d=[],f=document.getElementById("editassociated");f&&f.innerHTML.split(/<br\s*\/?>/i).forEach(function(e){var%20t=document.createElement("div");t.innerHTML=e;var%20o=t.textContent.trim();o&&d.push(o)});var%20s={};s[m(c)]=!0;var%20v=[];d.forEach(function(e){var%20t=m(e);e&&t&&!s[t]&&(s[t]=!0,v.push(e))});var%20a=l(document.getElementById("editstatus")),g=/complet/i.test(a)?"Completed":/hiatus/i.test(a)?"Hiatus":/ongoing/i.test(a)?"Ongoing":/cancel|discontinu|drop/i.test(a)?"Canceled":null,n=r("og:image");if(!n){var%20h=document.querySelector(".seriesimg%20img");n=h?h.src:null}var%20p={slug:E,titulo:c,titulosAlternativos:v,statusPublicacao:g,statusPublicacaoBruto:g?null:a||null,capaUrl:n,url:u,autores:i("showauthors"),artistas:i("showartists"),generos:i("seriesgenre"),tags:i("showtags")};if(n)try{var%20y=await%20fetch(n);if(y.ok){var%20C=await%20y.blob();p.capaBase64=await%20new%20Promise(function(e){var%20t=new%20FileReader;t.onloadend=function(){e(t.result)},t.readAsDataURL(C)})}}catch{}var%20S=JSON.stringify(p),B=new%20TextEncoder().encode(S),b="";B.forEach(function(e){b+=String.fromCharCode(e)});var%20q=btoa(b).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");location.href="https://blair-boo.github.io/manga-lists/importar-novelupdates#d="+q}catch(r){alert("Erro%20no%20bookmarklet:%20"+(r&&r.message||r))}})();})();
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
`NovelImportada` em `src/lib/novelupdatesImport.ts` mudar, conferir se os campos
acima continuam batendo.
