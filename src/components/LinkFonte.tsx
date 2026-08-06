import { useState } from 'react';
import { useDialogos } from './Dialogo';
import { useToast } from './Toast';
import { IconeColorido } from './Icones';
import { useLongPress } from '../hooks/useLongPress';
import { deleteFonte } from '../db/repo';
import { adicionarFonteNaObra } from '../lib/adicionarFonte';
import type { Fonte, Tipo } from '../types';

interface LinkFonteProps {
  nomeServico: string;
  icone: string;
  /** Domínio esperado — a fonte "é" esse ícone quando a URL bate aqui. */
  hostEsperado: RegExp;
  obraId: string;
  tipoObra: Tipo | null;
  fontes: Fonte[];
}

/**
 * Ícone que espelha uma fonte específica (Comix.to/Lehzin/Webtoon/Tapas) — sem
 * campo próprio na obra, ao contrário do LinkExterno: o "link" é a fonte cuja
 * URL bate com hostEsperado. Adicionar cria uma fonte nova (mesmo caminho do
 * formulário de fontes); remover é o mesmo deleteFonte usado na seção Sources.
 */
export function LinkFonte({ nomeServico, icone, hostEsperado, obraId, tipoObra, fontes }: LinkFonteProps) {
  const { confirmar, pedirTexto } = useDialogos();
  const { mostrarToast } = useToast();
  const [salvando, setSalvando] = useState(false);
  const fonte = fontes.find((f) => hostEsperado.test(f.url));

  async function handleAdicionar() {
    const texto = await pedirTexto({
      titulo: `${nomeServico} link`,
      mensagem: `Paste the ${nomeServico} URL for this work:`,
      confirmarRotulo: 'Add',
    });
    if (texto === null) return;
    const limpo = texto.trim();
    if (!limpo) return;
    if (!hostEsperado.test(limpo)) {
      mostrarToast(`That doesn't look like a ${nomeServico} URL`, 'info');
      return;
    }
    setSalvando(true);
    try {
      await adicionarFonteNaObra(obraId, limpo, tipoObra, fontes);
    } finally {
      setSalvando(false);
    }
  }

  async function handleRemover() {
    if (!fonte) return;
    const ok = await confirmar({
      titulo: `Remove ${nomeServico} source`,
      mensagem: `Remove the ${nomeServico} source from this work?`,
      confirmarRotulo: 'Remove',
      perigoso: true,
    });
    if (!ok) return;
    await deleteFonte(fonte.id);
  }

  const pressHandlers = useLongPress({
    onClick: () => {
      if (fonte) window.open(fonte.url, '_blank', 'noopener,noreferrer');
      else void handleAdicionar();
    },
    onLongPress: () => {
      if (fonte) void handleRemover();
      else void handleAdicionar();
    },
  });

  return (
    <button
      type="button"
      className={`btn-icone link-externo-botao ${fonte ? '' : 'link-externo-vazio'}`}
      aria-label={fonte ? `Open on ${nomeServico}` : `Add ${nomeServico} link`}
      title={nomeServico}
      disabled={salvando}
      {...pressHandlers}
    >
      <IconeColorido arquivo={icone} />
    </button>
  );
}
