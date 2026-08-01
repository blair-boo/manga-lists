// ==UserScript==
// @name         Comix.to — Exportar biblioteca
// @namespace    manga-lists
// @version      1.0
// @description  Percorre o catálogo do comix.to (/api/v1/manga) e baixa um JSON com título, títulos alternativos e url de cada obra — pra importar no manga-lists com import_comix_catalogo.py.
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
// docs/SCRAPING_API_COMIX.md). Só lê o catálogo (título/urls); não baixa
// capítulos nem conteúdo protegido.

(function () {
  "use strict";

  const LIMITE_PAGINA = 100;
  const DELAY_MS = 500; // pausa entre páginas, gentil com o site

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function buscarPagina(pagina) {
    const url = `${location.origin}/api/v1/manga?page=${pagina}&limit=${LIMITE_PAGINA}`;
    const resp = await fetch(url, {
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} na página ${pagina}`);
    }
    const dados = await resp.json();
    const resultado = dados && dados.status === "ok" ? dados.result : dados;
    return {
      items: (resultado && resultado.items) || [],
      hasNext: !!(resultado && resultado.meta && resultado.meta.hasNext),
    };
  }

  function baixarJson(itens) {
    // Só os campos que o importador usa: title/altTitles/url (match de título
    // + slug canônico). Ver _pares_titulo_url/_titulos_do_item em
    // adapters_novos.py — o formato bate com o item cru da API de propósito.
    const payload = itens.map((it) => ({
      title: it.title,
      altTitles: it.altTitles || [],
      url: it.url,
    }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
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
