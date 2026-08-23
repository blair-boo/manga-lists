import type { Documento } from './tipos';

const PREFIXO: Record<string, string> = { h1: '# ', h2: '## ', h3: '### ', citacao: '> ', 'item-lista': '- ' };

export function documentoParaMarkdown(doc: Documento): string {
  const linhas: string[] = [`# ${doc.titulo}`, ''];

  doc.blocos.forEach((bloco, indice) => {
    linhas.push(`${PREFIXO[bloco.tipo] ?? ''}${bloco.texto}`);
    const proximo = doc.blocos[indice + 1];
    const mesmaLista = bloco.tipo === 'item-lista' && proximo?.tipo === 'item-lista';
    if (!mesmaLista) linhas.push('');
  });

  return linhas.join('\n').trim() + '\n';
}

export function baixarMarkdown(doc: Documento, nomeArquivo: string): void {
  const blob = new Blob([documentoParaMarkdown(doc)], { type: 'text/markdown;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
}
