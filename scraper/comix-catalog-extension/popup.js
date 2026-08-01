const urlBaseEl = document.getElementById("urlBase");
const limiteEl = document.getElementById("limite");
const statusEl = document.getElementById("status");

function formatarEstado(estado) {
  if (!estado) return "Nenhum export em andamento.";
  const linhas = [];
  linhas.push(`Página atual: ${estado.pagina}`);
  linhas.push(`Páginas concluídas: ${estado.paginasFeitas || 0}`);
  linhas.push(`Obras coletadas: ${(estado.itens || []).length}`);
  if (estado.concluido) linhas.push("✔ Concluído.");
  else if (estado.ativo) linhas.push(estado.aguardando ? "Carregando página em segundo plano…" : "Rodando…");
  else linhas.push("Parado.");
  if (estado.erro) linhas.push(`ERRO: ${estado.erro}`);
  return linhas.join("\n");
}

async function atualizarUI() {
  const { crawl } = await chrome.storage.local.get("crawl");
  statusEl.textContent = formatarEstado(crawl);
  statusEl.classList.toggle("erro", !!(crawl && crawl.erro));
  if (crawl && crawl.urlBase && !urlBaseEl.value) urlBaseEl.value = crawl.urlBase;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.crawl) atualizarUI();
});

document.getElementById("btnIniciar").addEventListener("click", () => {
  const urlBase = urlBaseEl.value.trim();
  if (!urlBase) {
    alert("Cola a URL do /browse primeiro.");
    return;
  }
  const limite = Number(limiteEl.value) || 0;
  chrome.runtime.sendMessage({ tipo: "iniciar", urlBase, limitePaginas: limite });
});

document.getElementById("btnContinuar").addEventListener("click", () => {
  chrome.runtime.sendMessage({ tipo: "continuar" });
});

document.getElementById("btnParar").addEventListener("click", () => {
  chrome.runtime.sendMessage({ tipo: "parar" });
});

document.getElementById("btnLimpar").addEventListener("click", () => {
  if (confirm("Limpar o progresso coletado até agora?")) {
    chrome.runtime.sendMessage({ tipo: "limpar" });
    urlBaseEl.value = "";
  }
});

document.getElementById("btnBaixar").addEventListener("click", async () => {
  const { crawl } = await chrome.storage.local.get("crawl");
  const itens = (crawl && crawl.itens) || [];
  if (itens.length === 0) {
    alert("Nada coletado ainda.");
    return;
  }
  // Dedup por hid/id/url — o catálogo pode reordenar levemente durante um
  // crawl longo (ex.: uma obra recebe capítulo novo e sobe de página).
  const vistos = new Set();
  const dedupe = [];
  for (const it of itens) {
    const chave = it && (it.hid || it.id || it.url);
    if (chave && vistos.has(chave)) continue;
    if (chave) vistos.add(chave);
    dedupe.push(it);
  }
  const blob = new Blob([JSON.stringify(dedupe)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `comix_catalogo_filtrado_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

atualizarUI();
