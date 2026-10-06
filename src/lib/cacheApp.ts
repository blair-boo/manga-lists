/**
 * Esvazia os caches do PWA (precache do workbox + caches de runtime: capas,
 * API, ícones) e desregistra o service worker. NÃO toca no IndexedDB: dados
 * offline e a fila de sync pendente ficam intactos. Chamar window.location
 * .reload() depois: o SW é registrado de novo no carregamento e refaz o precache.
 */
export async function limparCachesApp(): Promise<void> {
  if ('caches' in window) {
    const nomes = await caches.keys();
    await Promise.all(nomes.map((nome) => caches.delete(nome)));
  }
  if ('serviceWorker' in navigator) {
    const registros = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registros.map((r) => r.unregister()));
  }
}
