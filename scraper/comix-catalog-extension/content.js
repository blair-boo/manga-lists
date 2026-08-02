// Intercepta (sem bloquear) a resposta do endpoint de listagem do comix
// (/api/v1/manga) sempre que a PRÓPRIA página faz essa chamada — o que só
// acontece de verdade quando a aba navega pra /browse (navegação real =
// token anti-bot resolvido pelo próprio site; ver docs/SCRAPING_API_COMIX.md
// no repo manga-lists pro histórico de por que isso é necessário: nem
// providers de scraping renderizados nem replays da query conseguem imitar
// esse token).
//
// run_at document_start garante que o patch entra ANTES do bundle da SPA
// rodar e disparar a primeira chamada. Cobre fetch E XMLHttpRequest — o
// axios do site usa XHR por baixo (confirmado ao vivo tentando só fetch).

(function () {
  "use strict";
  const MARCADOR = "/api/v1/manga";

  function enviar(texto) {
    try {
      chrome.runtime.sendMessage({ tipo: "comix-manga-response", texto });
    } catch (e) {
      // extensão pode não estar com o listener pronto nesse instante; sem problema
    }
  }

  const fetchOriginal = window.fetch;
  window.fetch = function (...args) {
    const alvo = typeof args[0] === "string" ? args[0] : args[0] && args[0].url;
    const promessa = fetchOriginal.apply(this, args);
    if (alvo && alvo.includes(MARCADOR)) {
      promessa
        .then((resp) => resp.clone().text())
        .then(enviar)
        .catch(() => {});
    }
    return promessa;
  };

  const XHR = window.XMLHttpRequest;
  const openOriginal = XHR.prototype.open;
  const sendOriginal = XHR.prototype.send;
  XHR.prototype.open = function (method, url, ...resto) {
    this.__comixAlvo = url;
    return openOriginal.call(this, method, url, ...resto);
  };
  XHR.prototype.send = function (...args) {
    if (typeof this.__comixAlvo === "string" && this.__comixAlvo.includes(MARCADOR)) {
      this.addEventListener("load", () => enviar(this.responseText));
    }
    return sendOriginal.apply(this, args);
  };

  // Diagnóstico: se o /api/v1/manga nunca responder (timeout no background),
  // a usuária normalmente não vê a aba (abre em segundo plano) e não tem como
  // saber o motivo. Manda um retrato da página alguns segundos depois de
  // carregar — título, se parece desafio do Cloudflare, URL final — pra
  // aparecer na mensagem de erro do popup em vez de um "timeout" genérico.
  function diagnosticoPagina() {
    const titulo = document.title || "";
    const corpo = (document.body && document.body.innerText) || "";
    const amostra = (titulo + " " + corpo).slice(0, 500);
    const pareceDesafio = /just a moment|verifying you are human|attention required|checking your browser|cf-chl/i.test(
      amostra
    );
    return { titulo, pareceDesafio, url: location.href };
  }

  function enviarDiagnostico() {
    try {
      chrome.runtime.sendMessage({ tipo: "comix-diagnostico", info: diagnosticoPagina() });
    } catch (e) {
      // idem: sem problema se ninguém estiver ouvindo
    }
  }

  // Duas leituras: uma cedo (pega desafio do Cloudflare, que aparece rápido)
  // e uma mais tarde (pega o estado já hidratado da SPA, se passou do desafio).
  setTimeout(enviarDiagnostico, 1500);
  setTimeout(enviarDiagnostico, 6000);
})();
