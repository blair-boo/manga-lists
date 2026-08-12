import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { parseArquivoImagens } from './imagensArquivo';
import { executarBatch, retentarItem, type ContextoDestino } from './imagensBatch';
import { normalizarNomeArquivo } from './imagensLinks';
import { escolherPastaLocal, listarArquivosPastaLocal, suportaDirectoryPicker, type PastaLocalHandle } from './imagensLocal';
import { itensDeLinhasArquivo, itensDeLinksColados, mesclarItens } from './imagensLista';
import { criarPastaSupabase, listarArquivosPastaSupabase, listarPastasSupabase } from './imagensSupabase';
import type { Destino, ItemImagem } from './imagensTipos';

/**
 * Hook de orquestração da aba Images (mesmo espírito de useUploadCapa em
 * src/components/CapaUploader.tsx): estado da lista de itens, destino/pasta
 * escolhidos e execução do lote. Markup fica todo em src/pages/ImagesPage.tsx.
 */

export interface ContagemAdicao {
  adicionados: number;
  invalidos: number;
  duplicados: number;
}

export function useImportacaoImagens() {
  const [itens, setItens] = useState<ItemImagem[]>([]);
  const [destino, setDestino] = useState<Destino>('supabase');
  const [pastaSupabase, setPastaSupabase] = useState('');
  const [pastasSupabase, setPastasSupabase] = useState<string[]>([]);
  const [carregandoPastas, setCarregandoPastas] = useState(false);
  const [pastaLocal, setPastaLocal] = useState<PastaLocalHandle | null>(null);
  const [rodando, setRodando] = useState(false);

  // Leitura síncrona do estado atual dentro de handlers async, sem esperar o
  // próximo render (setState é assíncrono/em lote no React).
  const itensRef = useRef<ItemImagem[]>([]);
  itensRef.current = itens;

  function adicionar(novosItens: ItemImagem[], invalidos: number): ContagemAdicao {
    const resultado = mesclarItens(itensRef.current, novosItens);
    setItens(resultado.itens);
    return { adicionados: novosItens.length - resultado.duplicados, invalidos, duplicados: resultado.duplicados };
  }

  function adicionarLinksColados(texto: string): ContagemAdicao {
    const { itens: novos, invalidos } = itensDeLinksColados(texto);
    return adicionar(novos, invalidos);
  }

  async function adicionarArquivo(file: File): Promise<ContagemAdicao> {
    const { linhas, linhasComProblema } = await parseArquivoImagens(file);
    const { itens: novos, invalidos } = itensDeLinhasArquivo(linhas);
    return adicionar(novos, invalidos + linhasComProblema);
  }

  function editarNome(id: string, novoNome: string) {
    setItens((atual) => atual.map((item) => (item.id === id ? { ...item, nome: normalizarNomeArquivo(novoNome) } : item)));
  }

  function removerItem(id: string) {
    setItens((atual) => atual.filter((item) => item.id !== id));
  }

  function limparTudo() {
    setItens([]);
  }

  async function carregarPastasSupabase() {
    setCarregandoPastas(true);
    try {
      setPastasSupabase(await listarPastasSupabase());
    } finally {
      setCarregandoPastas(false);
    }
  }

  async function criarPastaSupabaseUi(nome: string) {
    await criarPastaSupabase(nome);
    setPastaSupabase(nome);
    await carregarPastasSupabase();
  }

  async function escolherPastaLocalUi() {
    try {
      setPastaLocal(await escolherPastaLocal());
    } catch (err) {
      // Cancelar o picker nativo lança AbortError — não é um erro de verdade.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      throw err;
    }
  }

  function construirContextoDestino(): ContextoDestino {
    if (destino === 'supabase') return { destino: 'supabase', pasta: pastaSupabase };
    if (pastaLocal) return { destino: 'local', modo: 'directory-handle', pastaHandle: pastaLocal };
    return { destino: 'local', modo: 'blob-link' };
  }

  async function carregarNomesExistentes(contexto: ContextoDestino): Promise<Set<string>> {
    if (contexto.destino === 'supabase') return new Set(await listarArquivosPastaSupabase(contexto.pasta));
    if (contexto.modo === 'directory-handle') return new Set(await listarArquivosPastaLocal(contexto.pastaHandle));
    return new Set();
  }

  /** true quando o navegador suporta escolher pasta local de verdade mas a usuária ainda não escolheu uma — Import fica bloqueado até lá. */
  const precisaEscolherPastaLocal = destino === 'local' && suportaDirectoryPicker() && !pastaLocal;

  async function iniciarImportacao(): Promise<{ sucesso: number; erro: number }> {
    setRodando(true);
    try {
      const contexto = construirContextoDestino();
      const nomesExistentes = await carregarNomesExistentes(contexto);
      const pendentes = itensRef.current.filter((item) => item.status === 'pendente');
      return await executarBatch(pendentes, contexto, nomesExistentes, {
        onProgresso: (itemAtualizado) => {
          setItens((atual) => atual.map((item) => (item.id === itemAtualizado.id ? itemAtualizado : item)));
        },
      });
    } finally {
      setRodando(false);
    }
  }

  async function retentarItemUi(id: string): Promise<void> {
    const item = itensRef.current.find((i) => i.id === id);
    if (!item) return;
    setItens((atual) => atual.map((i) => (i.id === id ? { ...i, status: 'baixando' } : i)));
    const contexto = construirContextoDestino();
    const nomesExistentes = await carregarNomesExistentes(contexto);
    const resultado = await retentarItem(item, contexto, nomesExistentes);
    setItens((atual) => atual.map((i) => (i.id === id ? resultado : i)));
  }

  function handleArquivoSelecionado(onErro: (mensagem: string) => void, onSucesso: (contagem: ContagemAdicao) => void) {
    return async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        onSucesso(await adicionarArquivo(file));
      } catch (err) {
        onErro(err instanceof Error ? err.message : String(err));
      }
    };
  }

  return {
    itens,
    destino,
    setDestino,
    pastaSupabase,
    setPastaSupabase,
    pastasSupabase,
    carregandoPastas,
    carregarPastasSupabase,
    criarPastaSupabaseUi,
    pastaLocal,
    escolherPastaLocalUi,
    precisaEscolherPastaLocal,
    rodando,
    adicionarLinksColados,
    handleArquivoSelecionado,
    editarNome,
    removerItem,
    limparTudo,
    iniciarImportacao,
    retentarItemUi,
  };
}
