// ==UserScript==
// @name         Comix.to — Exportar biblioteca
// @namespace    manga-lists
// @version      1.2
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
// bundle do site). Estratégia: guardar a query completa da ÚLTIMA chamada
// real que a própria página fez pro /api/v1/manga (capturada passivamente,
// sem interferir) e reusar ela — com o token de verdade — só trocando o
// "page". Não depende de entender como o token é gerado, só empresta um
// válido.
//
// v1.2: confirmado ao vivo que só interceptar `fetch` não bastava — o
// espião nunca capturava nada mesmo depois de navegar o /browse. Sinal de
// que o axios do site usa o adapter XMLHttpRequest por baixo (o padrão dele
// em navegador), não fetch. Espião agora cobre os dois (fetch E
// XMLHttpRequest.prototype.open).
//
// Se o token for de uso único (amarrado à query exata da chamada
// original), reusar pra outra página pode falhar mesmo assim; nesse caso,
// navegue manualmente por umas 2-3 páginas do /browse (sem filtro de
// tipo/rating, pra pegar o catálogo todo) logo antes de clicar em
// exportar, pra manter uma query recente "fresca" pro script pegar.

(function () {
  "use strict";

  const LIMITE_PAGINA = 100; // real do site usa 28 na página /browse; não confirmado se o servidor honra 100 ou corta em silêncio — a paginação por hasNext funciona nos dois casos.
  const DELAY_MS = 500; // pausa entre páginas, gentil com o site

  const alvoWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  const fetchReal = alvoWindow.fetch.bind(alvoWindow);

  // Espiona (sem bloquear) chamadas que a PRÓPRIA página faz pro endpoint de
  // listagem, guardando a query completa (com o token real) da mais recente.
  // Cobre fetch E XMLHttpRequest: confirmado ao vivo que o fetch da própria
  // página (tentativa 1) toma 403 igual, e o espião original (só fetch)
  // nunca capturava nada mesmo depois de navegar — sinal de que o axios do
  // site usa o adapter XHR por baixo (o padrão dele em navegador), não fetch.
  let ultimaQueryReal = null;

  function registrarQuery(alvo) {
    try {
      if (typeof alvo === "string" && alvo.includes("/api/v1/manga")) {
        ultimaQueryReal = alvo.split("?")[1] || null;
      }
    } catch (e) {
      // não deixa a espionagem quebrar a navegação normal da página
    }
  }

  alvoWindow.fetch = function (...args) {
    registrarQuery(typeof args[0] === "string" ? args[0] : args[0] && args[0].url);
    return fetchReal(...args);
  };

  const XHROpenReal = alvoWindow.XMLHttpRequest.prototype.open;
  alvoWindow.XMLHttpRequest.prototype.open = function (method, url, ...resto) {
    registrarQuery(url);
    return XHROpenReal.call(this, method, url, ...resto);
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
