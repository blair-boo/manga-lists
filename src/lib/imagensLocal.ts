/**
 * Destino "dispositivo local" da aba Images. Pasta de verdade só é possível
 * via File System Access API (Chromium — `window.showDirectoryPicker`); os
 * tipos dessa API não fazem parte do lib.dom padrão do TypeScript, então são
 * declarados aqui, escopados a este módulo (sem `declare global`) pra não
 * arriscar colidir com uma definição futura do lib.dom.
 *
 * Firefox/Safari caem no fallback `baixarViaBlobLink`: sem escolha de pasta
 * real, os arquivos vão pra pasta padrão de Downloads do navegador — a UI
 * (ImagesPage) precisa deixar essa limitação explícita, não escondê-la.
 */

interface EscritorArquivoLocal {
  write(dados: Blob): Promise<void>;
  close(): Promise<void>;
}

interface ArquivoLocalHandle {
  readonly kind: 'file';
  readonly name: string;
  createWritable(): Promise<EscritorArquivoLocal>;
}

export interface PastaLocalHandle {
  readonly kind: 'directory';
  readonly name: string;
  getDirectoryHandle(nome: string, opcoes?: { create?: boolean }): Promise<PastaLocalHandle>;
  getFileHandle(nome: string, opcoes?: { create?: boolean }): Promise<ArquivoLocalHandle>;
  values(): AsyncIterableIterator<PastaLocalHandle | ArquivoLocalHandle>;
}

interface WindowComDirectoryPicker {
  showDirectoryPicker(): Promise<PastaLocalHandle>;
}

export function suportaDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as Partial<WindowComDirectoryPicker>).showDirectoryPicker === 'function';
}

export async function escolherPastaLocal(): Promise<PastaLocalHandle> {
  if (!suportaDirectoryPicker()) throw new Error('File System Access API not supported in this browser.');
  return (window as unknown as WindowComDirectoryPicker).showDirectoryPicker();
}

export async function criarSubpastaLocal(pastaPai: PastaLocalHandle, nome: string): Promise<PastaLocalHandle> {
  return pastaPai.getDirectoryHandle(nome, { create: true });
}

export async function listarSubpastasLocais(pastaPai: PastaLocalHandle): Promise<string[]> {
  const nomes: string[] = [];
  for await (const entrada of pastaPai.values()) {
    if (entrada.kind === 'directory') nomes.push(entrada.name);
  }
  return nomes;
}

/** Nomes de arquivo já existentes na pasta, pra resolução de colisão de nome antes de salvar. */
export async function listarArquivosPastaLocal(pastaPai: PastaLocalHandle): Promise<string[]> {
  const nomes: string[] = [];
  for await (const entrada of pastaPai.values()) {
    if (entrada.kind === 'file') nomes.push(entrada.name);
  }
  return nomes;
}

export async function salvarArquivoLocal(pasta: PastaLocalHandle, nomeArquivo: string, blob: Blob): Promise<void> {
  const arquivoHandle = await pasta.getFileHandle(nomeArquivo, { create: true });
  const writable = await arquivoHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

/** Fallback pra navegadores sem File System Access API: dispara um download normal (mesmo truque de baixarCsv em src/lib/csvBulkUpdate.ts). Cai sempre na pasta padrão de Downloads — sem escolha de pasta real. */
export function baixarViaBlobLink(nomeArquivo: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
}
