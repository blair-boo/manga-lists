import Papa from 'papaparse';

/**
 * Parse do arquivo de 2 colunas (link da imagem + nome pra salvar) da aba
 * Images. Aceita CSV e XLSX — os dois caem na mesma lógica de casamento de
 * coluna (linhasDeMatriz), operando sobre uma matriz de células crua.
 */

export interface LinhaArquivoImagens {
  link: string;
  nome: string;
}

export interface ResultadoParseArquivoImagens {
  linhas: LinhaArquivoImagens[];
  /** Linhas descartadas por não terem link (nome em branco é aceito — o nome final é derivado da URL). */
  linhasComProblema: number;
}

const CABECALHOS_LINK = ['link', 'image link', 'url', 'imagem', 'image url'];
const CABECALHOS_NOME = ['nome', 'name', 'filename', 'nome do arquivo', 'name to save the image as'];

export function detectarTipoArquivoImagens(file: File): 'csv' | 'xlsx' | null {
  const nome = file.name.toLowerCase();
  if (nome.endsWith('.csv')) return 'csv';
  if (nome.endsWith('.xlsx') || nome.endsWith('.xls')) return 'xlsx';
  if (file.type === 'text/csv') return 'csv';
  if (file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  return null;
}

function acharIndiceColuna(cabecalho: string[], candidatos: string[]): number {
  const normalizados = cabecalho.map((c) => c.trim().toLowerCase());
  for (const candidato of candidatos) {
    const idx = normalizados.indexOf(candidato);
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Converte uma matriz de linhas (cabeçalho incluso, se houver) em pares
 * {link, nome}. Casa cabeçalho por nome (sem diferenciar maiúsculas); quando
 * nenhuma célula da primeira linha bate com um cabeçalho conhecido, assume
 * que não há cabeçalho e cai no fallback posicional (coluna 1 = link, coluna
 * 2 = nome).
 */
function linhasDeMatriz(matriz: unknown[][]): ResultadoParseArquivoImagens {
  const linhasBrutas = matriz.filter((linha) => linha.some((celula) => String(celula ?? '').trim()));
  if (linhasBrutas.length === 0) return { linhas: [], linhasComProblema: 0 };

  const primeiraLinha = linhasBrutas[0].map((c) => String(c ?? ''));
  const idxLink = acharIndiceColuna(primeiraLinha, CABECALHOS_LINK);
  const idxNome = acharIndiceColuna(primeiraLinha, CABECALHOS_NOME);
  const temCabecalho = idxLink !== -1 || idxNome !== -1;

  const colLink = idxLink !== -1 ? idxLink : 0;
  const colNome = idxNome !== -1 ? idxNome : 1;
  const linhasDeDados = temCabecalho ? linhasBrutas.slice(1) : linhasBrutas;

  const linhas: LinhaArquivoImagens[] = [];
  let linhasComProblema = 0;
  for (const linha of linhasDeDados) {
    const link = String(linha[colLink] ?? '').trim();
    const nome = String(linha[colNome] ?? '').trim();
    if (!link) {
      linhasComProblema++;
      continue;
    }
    linhas.push({ link, nome });
  }
  return { linhas, linhasComProblema };
}

export async function parseArquivoImagens(file: File): Promise<ResultadoParseArquivoImagens> {
  const tipo = detectarTipoArquivoImagens(file);

  if (tipo === 'csv') {
    const texto = await file.text();
    const resultado = Papa.parse<string[]>(texto, { skipEmptyLines: true });
    return linhasDeMatriz(resultado.data);
  }

  if (tipo === 'xlsx') {
    // Import dinâmico: só carrega a lib (pesada) quando a usuária efetivamente
    // sobe um .xlsx — fica fora do bundle inicial E do precache do PWA (ver
    // globIgnores + runtimeCaching do chunk "xlsx-*" em vite.config.ts).
    const XLSX = await import('xlsx');
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const primeiraAba = workbook.SheetNames[0];
    if (!primeiraAba) return { linhas: [], linhasComProblema: 0 };
    const matriz = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[primeiraAba], { header: 1 });
    return linhasDeMatriz(matriz);
  }

  throw new Error('Unsupported file type: use .csv or .xlsx');
}
