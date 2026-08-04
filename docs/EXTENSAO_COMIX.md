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

Mesmo código, empacotado como `javascript:` URI de um único bookmark:

```js
javascript:(function(){
  var s = document.getElementById('initial-data');
  if (!s) { alert('initial-data não encontrado nesta página'); return; }
  var dados = JSON.parse(s.textContent);
  var hid = dados.manga && dados.manga.hid;
  var detalhe = dados.queries && dados.queries['["manga","detail","' + hid + '"]'];
  if (!detalhe) { alert('Detalhe da obra não encontrado'); return; }
  // normalizarComix/codificarPayload embutidos inline aqui (mesma lógica de
  // src/lib/comix.ts) — o bookmarklet não pode importar módulos.
  location.href = '<url-do-pwa>/importar#d=' + encodeURIComponent(payloadCodificado);
})();
```

O corpo real do bookmarklet precisa embutir uma cópia minificada de
`normalizarComix`/`codificarPayload` (não dá pra `import` de um bookmarklet).
Gerar essa cópia a partir de `src/lib/comix.ts` na hora de publicar o
bookmarklet, pra não divergir manualmente com o tempo.

## Fora de escopo aqui

- Manifest/permissões da extensão, ícone, popup UI — ficam no repositório da
  extensão quando ela for criada.
- Publicação em loja de extensões.
