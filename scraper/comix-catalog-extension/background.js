// Orquestra o crawl: abre uma aba em segundo plano por página do /browse
// (URL já filtrada pela usuária no site), espera o content.js interceptar a
// resposta real do /api/v1/manga daquela navegação, acumula os itens, fecha
// a aba e passa pra próxima página. Sequencial de propósito (uma aba por
// vez) — mais lento que paralelo, mas simples e gentil com o site.
//
// Estado persistido em chrome.storage.local (não em memória): um service
// worker MV3 pode ser encerrado entre eventos, e o estado em storage permite
// retomar de onde parou (botão "Continuar" no popup) sem perder o que já
// foi coletado.

const ESTADO_KEY = "crawl";
const DELAY_ENTRE_PAGINAS_MS = 1200; // pausa gentil entre uma aba fechar e a próxima abrir
const TIMEOUT_PAGINA_MS = 25000; // se a aba não responder nesse tempo, retenta (até 2x) e desiste
const MAX_FALHAS_SEGUIDAS = 2;

let timeoutAtual = null;

async function lerEstado() {
  const { [ESTADO_KEY]: estado } = await chrome.storage.local.get(ESTADO_KEY);
  return estado || null;
}

async function salvarEstado(estado) {
  await chrome.storage.local.set({ [ESTADO_KEY]: estado });
}

function paginaNaUrl(urlBase, pagina) {
  const u = new URL(urlBase);
  u.searchParams.set("page", String(pagina));
  return u.toString();
}

function extrairItensEMeta(texto) {
  let dados;
  try {
    dados = JSON.parse(texto);
  } catch (e) {
    return null;
  }
  const resultado = dados && dados.status === "ok" ? dados.result : dados;
  if (!resultado || !Array.isArray(resultado.items)) return null;
  return { items: resultado.items, hasNext: !!(resultado.meta && resultado.meta.hasNext) };
}

async function abrirPagina(estado) {
  if (timeoutAtual) {
    clearTimeout(timeoutAtual);
    timeoutAtual = null;
  }
  const url = paginaNaUrl(estado.urlBase, estado.pagina);
  const tab = await chrome.tabs.create({ url, active: false });
  estado.tabId = tab.id;
  estado.aguardando = true;
  await salvarEstado(estado);

  timeoutAtual = setTimeout(async () => {
    const atual = await lerEstado();
    if (!atual || !atual.ativo || atual.tabId !== tab.id) return;
    try {
      await chrome.tabs.remove(tab.id);
    } catch (e) {
      // aba já pode ter sido fechada
    }
    atual.falhasSeguidas = (atual.falhasSeguidas || 0) + 1;
    atual.aguardando = false;
    if (atual.falhasSeguidas >= MAX_FALHAS_SEGUIDAS) {
      atual.ativo = false;
      atual.erro = `Timeout esperando a página ${atual.pagina} (${MAX_FALHAS_SEGUIDAS} tentativas) — dados coletados até aqui ficam disponíveis pra baixar.`;
      await salvarEstado(atual);
      return;
    }
    await salvarEstado(atual);
    await abrirPagina(atual); // retenta a mesma página
  }, TIMEOUT_PAGINA_MS);
}

async function processarResposta(texto, tabId) {
  const estado = await lerEstado();
  if (!estado || !estado.ativo || !estado.aguardando || estado.tabId !== tabId) return;

  const extraido = extrairItensEMeta(texto);
  if (timeoutAtual) {
    clearTimeout(timeoutAtual);
    timeoutAtual = null;
  }
  try {
    await chrome.tabs.remove(tabId);
  } catch (e) {
    // aba já pode ter sido fechada
  }

  if (!extraido) {
    estado.falhasSeguidas = (estado.falhasSeguidas || 0) + 1;
    estado.aguardando = false;
    if (estado.falhasSeguidas >= MAX_FALHAS_SEGUIDAS) {
      estado.ativo = false;
      estado.erro = `Resposta inesperada na página ${estado.pagina} — dados coletados até aqui ficam disponíveis pra baixar.`;
      await salvarEstado(estado);
      return;
    }
    await salvarEstado(estado);
    setTimeout(() => abrirPagina(estado), DELAY_ENTRE_PAGINAS_MS);
    return;
  }

  estado.falhasSeguidas = 0;
  estado.itens = (estado.itens || []).concat(extraido.items);
  estado.paginasFeitas = (estado.paginasFeitas || 0) + 1;
  estado.aguardando = false;

  const semMais = extraido.items.length === 0 || !extraido.hasNext;
  const atingiuLimite = estado.limitePaginas > 0 && estado.paginasFeitas >= estado.limitePaginas;

  if (semMais || atingiuLimite) {
    estado.ativo = false;
    estado.concluido = true;
    await salvarEstado(estado);
    return;
  }

  estado.pagina += 1;
  await salvarEstado(estado);
  setTimeout(() => abrirPagina(estado), DELAY_ENTRE_PAGINAS_MS);
}

async function iniciar(urlBase, limitePaginas) {
  let paginaInicial = 1;
  try {
    paginaInicial = Number(new URL(urlBase).searchParams.get("page") || "1") || 1;
  } catch (e) {
    // urlBase inválida: mantém page=1 e deixa a aba real acusar o erro
  }
  const estado = {
    ativo: true,
    concluido: false,
    erro: null,
    urlBase,
    pagina: paginaInicial,
    limitePaginas: limitePaginas || 0,
    itens: [],
    paginasFeitas: 0,
    falhasSeguidas: 0,
    tabId: null,
    aguardando: false,
  };
  await salvarEstado(estado);
  await abrirPagina(estado);
}

async function continuar() {
  const estado = await lerEstado();
  if (!estado || estado.concluido) return;
  estado.ativo = true;
  estado.erro = null;
  estado.falhasSeguidas = 0;
  await salvarEstado(estado);
  await abrirPagina(estado);
}

async function parar() {
  const estado = await lerEstado();
  if (!estado) return;
  if (timeoutAtual) {
    clearTimeout(timeoutAtual);
    timeoutAtual = null;
  }
  if (estado.tabId) {
    try {
      await chrome.tabs.remove(estado.tabId);
    } catch (e) {
      // aba já pode ter sido fechada
    }
  }
  estado.ativo = false;
  estado.aguardando = false;
  await salvarEstado(estado);
}

async function limpar() {
  if (timeoutAtual) {
    clearTimeout(timeoutAtual);
    timeoutAtual = null;
  }
  const estado = await lerEstado();
  if (estado && estado.tabId) {
    try {
      await chrome.tabs.remove(estado.tabId);
    } catch (e) {
      // aba já pode ter sido fechada
    }
  }
  await chrome.storage.local.remove(ESTADO_KEY);
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || typeof msg.tipo !== "string") return;
  switch (msg.tipo) {
    case "comix-manga-response":
      processarResposta(msg.texto, sender.tab && sender.tab.id);
      break;
    case "iniciar":
      iniciar(msg.urlBase, msg.limitePaginas);
      break;
    case "continuar":
      continuar();
      break;
    case "parar":
      parar();
      break;
    case "limpar":
      limpar();
      break;
    default:
      break;
  }
});
