// ==UserScript==
// @name         Comix.to — Exportar biblioteca
// @namespace    manga-lists
// @version      1.1
// @description  Percorre o catálogo do comix.to (/api/v1/manga) e baixa um JSON com o item completo de cada obra — pra importar no manga-lists com import_comix_catalogo.py.
// @match        https://comix.to/*
// @match        https://comix.ws/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// Por que isso roda no navegador e não no servidor: o catálogo do comix
// (/api/v1/manga) fica atrás de um Cloudflare que só libera JSON pra request
// com cara de XHR same-origin. Rodando aqui dentro, o script herda o cookie
// do Cloudflare da sua sessão normal e faz um fetch same-origin de verdade —
// os dois obstáculos que travaram tentar isso de um servidor (ver
// docs/SCRAPING_API_COMIX.md). Só lê o catálogo (título/urls/status); não
// baixa capítulos nem conteúdo protegido.
//
// v1.1: a v1.0 tomava 403 direto (confirmado: chamada real do site inclui
// content_rating[]/types[] do filtro ativo E um parâmetro "_" opaco de ~130
// caracteres que não é timestamp — tem cara de token anti-bot gerado pelo
// bundle do site). Duas mudanças:
//
// 1. Usa `unsafeWindow.fetch` em vez do `fetch` do userscript. Tampermonkey
//    roda o script num mundo JS isolado por padrão, com seu próprio `fetch`
//    limpo, separado do `fetch` da página real — que pode estar remendado
//    (pelo Cloudflare ou pelo bundle do site) pra grudar esse token
//    automaticamente. Chamando o fetch DA PÁGINA, herdamos esse remendo, se
//    for isso mesmo.
// 2. Se ainda assim vier 403: guarda a query completa da ÚLTIMA chamada real
//    que a própria página fez pro /api/v1/manga (capturada passivamente,
//    sem interferir) e reusa ela — com o token de verdade — só trocando o
//    "page". Não depende de entender como o token é gerado, só empresta um
//    válido. Se o token for de uso único (amarrado à query exata), essa
//    segunda tentativa também falha; nesse caso, navegue manualmente por
//    umas 2-3 páginas do /browse (sem filtro de tipo/rating, pra pegar o
//    catálogo todo) logo antes de clicar em exportar, pra manter uma query
//    recente "fresca" pro script pegar.

(function () {
  "use strict";

  const LIMITE_PAGINA = 100; // real do site usa 28 na página /browse; não confirmado se o servidor honra 100 ou corta em silêncio — a paginação por hasNext funciona nos dois casos.
  const DELAY_MS = 500; // pausa entre páginas, gentil com o site

  const alvoWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  const fetchReal = alvoWindow.fetch.bind(alvoWindow);

  // Espiona (sem bloquear) chamadas que a PRÓPRIA página faz pro endpoint de
  // listagem, guardando a query completa (com o token real) da mais recente.
  let ultimaQueryReal = null;
  alvoWindow.fetch = function (...args) {
    try {
      const alvo = typeof args[0] === "string" ? args[0] : args[0] && args[0].url;
      if (alvo && alvo.includes("/api/v1/manga")) {
        ultimaQueryReal = alvo.split("?")[1] || null;
      }
    } catch (e) {
      // não deixa a espionagem quebrar a navegação normal da página
    }
    return fetchReal(...args);
  };

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function urlComPagina(query, pagina) {
    const params = new URLSearchParams(query);
    params.set("page", String(pagina));
    if (!params.has("limit")) params.set("limit", String(LIMITE_PAGINA));
    return `${location.origin}/api/v1/manga?${params.toString()}`;
  }

  async function tentarFetch(url) {
    return fetchReal(url, {
      credentials: "same-origin",
      headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
    });
  }

  async function buscarPagina(pagina) {
    // Tentativa 1: parâmetros mínimos nossos, via fetch real da página.
    let resp = await tentarFetch(urlComPagina(`page=${pagina}&limit=${LIMITE_PAGINA}`, pagina));

    // Tentativa 2: empresta a query de uma chamada real recente (token incluso).
    if (resp.status === 403 && ultimaQueryReal) {
      resp = await tentarFetch(urlComPagina(ultimaQueryReal, pagina));
    }

    if (!resp.ok) {
      const dica = ultimaQueryReal
        ? ""
        : " (nenhuma chamada real capturada ainda — navegue 2-3 páginas do /browse antes de exportar)";
      throw new Error(`HTTP ${resp.status} na página ${pagina}${dica}`);
    }
    const dados = await resp.json();
    const resultado = dados && dados.status === "ok" ? dados.result : dados;
    return {
      items: (resultado && resultado.items) || [],
      hasNext: !!(resultado && resultado.meta && resultado.meta.hasNext),
    };
  }

  function baixarJson(itens) {
    // Exporta o item CRU e completo (não recorta campos) — não sabemos ainda
    // se altTitles/status vêm no item do catálogo ou só na página da obra;
    // melhor guardar tudo do que chutar o formato e perder dado.
    const blob = new Blob([JSON.stringify(itens)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `comix_catalogo_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function criarBotao() {
    const btn = document.createElement("button");
    btn.textContent = "Exportar biblioteca comix";
    Object.assign(btn.style, {
      position: "fixed",
      top: "12px",
      right: "12px",
      zIndex: 999999,
      padding: "10px 14px",
      background: "#7c3aed",
      color: "#fff",
      border: "none",
      borderRadius: "8px",
      fontSize: "13px",
      fontWeight: "600",
      fontFamily: "sans-serif",
      cursor: "pointer",
      boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
    });
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const todos = [];
      let pagina = 1;
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          btn.textContent = `Exportando… página ${pagina} (${todos.length} obras)`;
          const { items, hasNext } = await buscarPagina(pagina);
          if (!items.length) break;
          todos.push(...items);
          if (!hasNext) break;
          pagina += 1;
          await delay(DELAY_MS);
        }
        baixarJson(todos);
        btn.textContent = `Pronto! ${todos.length} obras exportadas`;
      } catch (err) {
        console.error("Exportar biblioteca comix — erro:", err);
        btn.textContent = "Erro — ver console (F12)";
      } finally {
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = "Exportar biblioteca comix";
        }, 5000);
      }
    });
    document.body.appendChild(btn);
  }

  criarBotao();
})();
