# Comix.to — Exportar catálogo (filtrado)

Extensão de navegador (não é userscript — precisa da permissão `tabs`, que
Tampermonkey não dá) que percorre o catálogo do comix.to abrindo **páginas
reais em segundo plano**, uma por vez, e junta os resultados num JSON pra
importar no manga-lists com `import_comix_catalogo.py`.

## Por que uma extensão, e não o userscript de novo

O `comix_library_export.user.js` (na pasta `scraper/`) tenta chamar a API
(`/api/v1/manga`) diretamente — e sempre esbarra num token anti-bot opaco que
só é válido quando a chamada nasce de uma **navegação real** da página (não
dá pra forjar nem reaproveitar de outra página). O `/browse` também não
embute a lista no HTML inicial (só filtros), então não dá pra ler direto do
HTML como a página de cada obra permite.

Esta extensão contorna isso do mesmo jeito que extensões como o
[comix-downloader](https://github.com/N3uralCreativity/comix-downloader) —
não copiando o código deles (que existe pra baixar capítulo/zip, não
precisamos de nada disso), só a técnica: abre uma aba de verdade em
`/browse?...&page=N`, deixa o **próprio site** fazer a chamada (token
resolvido automaticamente, porque é navegação real), intercepta a resposta
com um content script, fecha a aba e passa pra próxima página. Repete
sozinha, sem você precisar clicar em nada durante o processo.

## Por que a URL de filtro é colada, não escolhida na extensão

Em vez de eu tentar adivinhar o nome de cada parâmetro de filtro do
`/browse` (gênero, status, content rating, formato...) — o que já deu errado
repetidas vezes tentando imitar a API diretamente — a extensão deixa você
aplicar os filtros que quiser **no próprio site**, que sabe montar a URL
certo. Você só copia essa URL (já filtrada) e cola na extensão; ela só
incrementa o `page=N` por cima dela, preservando o resto exatamente como
veio.

## Como instalar (Chrome/Edge/Brave — Chromium)

1. Abra `chrome://extensions` (ou `edge://extensions`).
2. Ative o "Modo do desenvolvedor" (canto superior direito).
3. Clique em "Carregar sem compactação" e selecione esta pasta
   (`scraper/comix-catalog-extension`).
4. O ícone da extensão aparece na barra de ferramentas.

## Como usar

1. No comix.to, vá em `/browse` e aplique os filtros que quiser (tipo,
   status, gênero, rating, ordenação...).
2. Copia a URL da barra de endereço (com os filtros aplicados).
3. Clica no ícone da extensão, cola a URL no campo, e clica em **Iniciar**.
4. Acompanha o progresso no popup (pode fechar e reabrir — o crawl continua
   rodando em segundo plano; reabrir só atualiza o status). Uma aba vai
   piscar na barra de abas a cada página — é esperado.
5. Quando terminar (ou quando quiser parar), clica em **Baixar JSON
   coletado**. Baixa `comix_catalogo_filtrado_<data>.json`.
6. Importa no app:
   ```
   cd scraper
   python import_comix_catalogo.py ~/Downloads/comix_catalogo_filtrado_2026-08-01.json
   ```

### Botões do popup

- **Iniciar**: começa um crawl novo a partir da URL colada (zera o que
  tiver coletado antes).
- **Continuar**: retoma um crawl que parou (erro de timeout após 2
  tentativas, ou que você parou manualmente) sem perder o que já foi
  coletado.
- **Parar**: pausa o crawl onde estiver (dá pra continuar depois, ou baixar
  o que já foi coletado).
- **Baixar JSON coletado**: funciona a qualquer momento, mesmo com o crawl
  ainda rodando ou parado no meio — baixa o que já foi juntado até agora
  (dedupe por `hid`/`id`/`url`).
- **Limpar**: apaga o progresso guardado, pra começar do zero com outra URL.

## Limitações conhecidas

- Sequencial (uma aba por vez, com uma pausa curta entre páginas) — gentil
  com o site, mas não é instantâneo. Pra referência: ~5.300 títulos com
  filtro, a ~28/página, são umas 190 páginas.
- Se o Chrome encerrar o service worker da extensão no meio (inatividade
  prolongada), o crawl pausa sozinho; reabra o popup e clique em
  **Continuar**.
- O formato do item exportado é o item cru da API (`title`, `altTitles`,
  `url`, `status`, etc.) — o mesmo que `import_comix_catalogo.py` já sabe
  ler.
