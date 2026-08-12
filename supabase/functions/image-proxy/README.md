# image-proxy

Edge Function de leitura pura: recebe a URL de uma imagem qualquer, busca os
bytes no servidor e devolve pro cliente com CORS liberado.

Existe porque a aba Images (Settings) baixa imagens de domínios de terceiros
escolhidos pela usuária, e a maioria não manda cabeçalho CORS — o navegador
não consegue buscar direto (mesmo motivo de existir de `comix-fetch`, ver
README daquela pasta).

Genérica de propósito: não sabe nada sobre Supabase Storage, dispositivo
local ou qualquer destino de gravação — só busca a URL e devolve bytes. Todo
o roteamento por destino (local/Supabase) vive no cliente
(`src/lib/imagensBatch.ts`, `imagensSupabase.ts`, `imagensLocal.ts`).

## Contrato

- Body: `{ "url": "https://exemplo.com/capa.jpg" }`
- 200: bytes crus da imagem. `Content-Type` da resposta é sempre
  `application/octet-stream` (não o tipo real) — necessário pro cliente
  supabase-js fazer parse automático como `Blob` em vez de tentar decodificar
  como texto. O tipo real da imagem (`image/png`, `image/jpeg`, ...) vai no
  header `X-Image-Content-Type`; ver `src/lib/imageProxy.ts`.
- 400: URL ausente, não-`https://`, ou host que parece rede privada/loopback
  (mitigação best-effort de SSRF — não protege contra DNS rebinding).
- 415: a origem respondeu, mas o `Content-Type` não começa com `image/`.
- 413: a imagem passou de 25MB (limite checado durante a leitura, não só via
  `Content-Length`).
- 502: falha de rede, timeout (15s) ou a origem não respondeu 2xx.

A autenticação já é garantida pelo Supabase, que valida o JWT antes de
invocar a função — nenhuma checagem própria aqui.

## Deploy

```
supabase functions deploy image-proxy
```

Não precisa de nenhum secret.

## Fronteiras (decisão explícita — não cruzar)

Assim como `comix-fetch`, esta função fica isolada de qualquer lógica de
destino: não escreve em `storage.objects`, não conhece Google Drive, não lê
nem escreve em tabela nenhuma. Se um dia existir um
`supabase/functions/_shared/`, `CORS_HEADERS` pode migrar pra lá — até então
fica duplicado de propósito (mesma decisão de `comix-fetch`).
