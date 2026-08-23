import type { Template } from './tipos';

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

interface RunInfo {
  texto: string;
  tamanhoPt: number;
  negrito: boolean;
  cor: string | null;
  fonte: string | null;
}

function primeiroFilhoNS(el: Element, tag: string): Element | null {
  return el.getElementsByTagNameNS(NS_W, tag)[0] ?? null;
}

function atributoNumNS(el: Element, tag: string, atributo: string): number | null {
  const valor = primeiroFilhoNS(el, tag)?.getAttributeNS(NS_W, atributo);
  return valor ? Number(valor) : null;
}

function atributoCorNS(el: Element, tag: string, atributo: string): string | null {
  const valor = primeiroFilhoNS(el, tag)?.getAttributeNS(NS_W, atributo);
  if (!valor || valor.toLowerCase() === 'auto') return null;
  return `#${valor}`;
}

function extrairRuns(documentXml: Document): RunInfo[] {
  const runs: RunInfo[] = [];
  for (const r of Array.from(documentXml.getElementsByTagNameNS(NS_W, 'r'))) {
    const texto = Array.from(r.getElementsByTagNameNS(NS_W, 't'))
      .map((t) => t.textContent ?? '')
      .join('');
    if (!texto.trim()) continue;

    const szMeioPontos = atributoNumNS(r, 'sz', 'val');
    runs.push({
      texto,
      tamanhoPt: szMeioPontos ? szMeioPontos / 2 : 11,
      negrito: r.getElementsByTagNameNS(NS_W, 'b').length > 0,
      cor: atributoCorNS(r, 'color', 'val'),
      fonte: primeiroFilhoNS(r, 'rFonts')?.getAttributeNS(NS_W, 'ascii') || null,
    });
  }
  return runs;
}

function extrairEspacamentosDepois(documentXml: Document): number[] {
  const valores: number[] = [];
  for (const p of Array.from(documentXml.getElementsByTagNameNS(NS_W, 'p'))) {
    const pPr = primeiroFilhoNS(p, 'pPr');
    const after = pPr && atributoNumNS(pPr, 'spacing', 'after');
    if (after !== null && after !== undefined) valores.push(after / 20);
  }
  return valores;
}

function corDoHeading1(stylesXml: Document | null): string | null {
  if (!stylesXml) return null;
  for (const estilo of Array.from(stylesXml.getElementsByTagNameNS(NS_W, 'style'))) {
    if (estilo.getAttributeNS(NS_W, 'styleId') === 'Heading1') return atributoCorNS(estilo, 'color', 'val');
  }
  return null;
}

/** Item com maior peso total (soma de pesos por chave) — usado pra achar a fonte/cor/tamanho "dominante". */
function modaPorPeso<T>(itens: { chave: T; peso: number }[]): T | null {
  const somas = new Map<T, number>();
  for (const { chave, peso } of itens) somas.set(chave, (somas.get(chave) ?? 0) + peso);
  let melhorChave: T | null = null;
  let melhorPeso = -1;
  for (const [chave, peso] of somas) {
    if (peso > melhorPeso) {
      melhorChave = chave;
      melhorPeso = peso;
    }
  }
  return melhorChave;
}

function limitar(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor));
}

function mapearFontePdf(nomeFonte: string | null): Template['fontePdf'] {
  const nome = (nomeFonte ?? '').toLowerCase();
  if (/times|georgia|garamond|cambria|book antiqua|palatino|serif/.test(nome)) return 'times';
  if (/courier|consolas|mono/.test(nome)) return 'courier';
  return 'helvetica';
}

function pilhaCssFonte(nomeFonte: string | null, fontePdf: Template['fontePdf']): string {
  if (fontePdf === 'times') return `${nomeFonte ?? 'Georgia'}, "Times New Roman", serif`;
  if (fontePdf === 'courier') return `${nomeFonte ?? '"Courier New"'}, "Courier New", monospace`;
  return `${nomeFonte ?? 'Arial'}, Helvetica, sans-serif`;
}

/**
 * Deriva um `Template` (fonte, tamanhos, cor de destaque, espaçamento) a
 * partir de um .docx qualquer usado como referência visual — funciona tanto
 * com docs que usam estilos nomeados (Heading1/2/3) quanto com docs formatados
 * manualmente (como a maioria dos templates de ebook baixados prontos):
 * olha pra formatação de cada trecho de texto direto (negrito, tamanho, cor,
 * fonte) e usa o texto mais comum como "corpo" e os tamanhos em negrito acima
 * dele como os níveis de título, do maior pro menor.
 */
export async function parseTemplateDocxBuffer(arrayBuffer: ArrayBuffer, nomeArquivo: string): Promise<Template> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(arrayBuffer);

  const documentXmlTexto = await zip.file('word/document.xml')?.async('text');
  if (!documentXmlTexto) throw new Error('Invalid .docx: word/document.xml not found.');
  const stylesXmlTexto = await zip.file('word/styles.xml')?.async('text');

  const parser = new DOMParser();
  const documentXml = parser.parseFromString(documentXmlTexto, 'application/xml');
  const stylesXml = stylesXmlTexto ? parser.parseFromString(stylesXmlTexto, 'application/xml') : null;

  const runs = extrairRuns(documentXml);
  if (runs.length === 0) throw new Error('Could not find any formatted text in this .docx to build a template from.');

  const tamanhoCorpo = limitar(
    modaPorPeso(runs.map((r) => ({ chave: Math.round(r.tamanhoPt * 2) / 2, peso: r.texto.length }))) ?? 11,
    8,
    14
  );
  const fonteCorpo = modaPorPeso(runs.filter((r) => r.fonte).map((r) => ({ chave: r.fonte as string, peso: r.texto.length })));

  const tamanhosGrandes = [
    ...new Set(runs.filter((r) => r.negrito && r.tamanhoPt > tamanhoCorpo * 1.05).map((r) => Math.round(r.tamanhoPt * 2) / 2)),
  ].sort((a, b) => b - a);

  const titulo = limitar(tamanhosGrandes[0] ?? tamanhoCorpo * 2.3, 16, 60);
  const h1 = limitar(tamanhosGrandes[1] ?? titulo * 0.75, 13, 40);
  const h2 = limitar(tamanhosGrandes[2] ?? h1 * 0.78, 11, 32);
  const h3 = limitar(tamanhosGrandes[3] ?? h2 * 0.85, 10, 26);

  const corDestaque =
    modaPorPeso(runs.filter((r) => r.cor).map((r) => ({ chave: r.cor as string, peso: 1 }))) ?? corDoHeading1(stylesXml) ?? '#333333';

  const espacamentos = extrairEspacamentosDepois(documentXml).filter((v) => v > 0 && v <= 36);
  const espacamentoParagraphoPt = limitar(modaPorPeso(espacamentos.map((v) => ({ chave: v, peso: 1 }))) ?? 8, 0, 24);

  const fontePdf = mapearFontePdf(fonteCorpo);

  return {
    id: 'custom',
    nome: nomeArquivo.replace(/\.docx$/i, ''),
    descricao: 'Custom template — from an uploaded .docx.',
    fonte: pilhaCssFonte(fonteCorpo, fontePdf),
    fontePdf,
    corDestaque,
    tamanhosPt: { titulo, h1, h2, h3, paragrafo: tamanhoCorpo, 'item-lista': tamanhoCorpo, citacao: tamanhoCorpo },
    espacamentoParagraphoPt,
  };
}

export async function parseTemplateDocx(arquivo: File): Promise<Template> {
  return parseTemplateDocxBuffer(await arquivo.arrayBuffer(), arquivo.name);
}
