import { useDialogos } from './Dialogo';
import { useToast } from './Toast';
import { IconeColorido } from './Icones';
import { useLongPress } from '../hooks/useLongPress';

interface LinkExternoProps {
  /** Nome do serviço, usado nos textos de diálogo/toast e como title (tooltip). */
  nomeServico: string;
  /** Caminho do ícone colorido no bucket "icons" (pasta w-color/), 20x20. */
  icone: string;
  url: string | null;
  /** Host esperado da URL colada — rejeita e avisa se não bater. */
  hostEsperado: RegExp;
  onChange: (url: string | null) => void;
}

/**
 * Ícone de link externo (sem rótulo — o nome aparece só no title/tooltip):
 * clique curto abre o link (ou o diálogo de adicionar, se vazio); pressionar
 * e segurar abre o diálogo de remover. Parametrizado pra cobrir os seis links
 * de catálogo (NU/AniList/MyAnimeList/MangaUpdates/MangaDex/MangaBaka).
 */
export function LinkExterno({ nomeServico, icone, url, hostEsperado, onChange }: LinkExternoProps) {
  const { confirmar, pedirTexto } = useDialogos();
  const { mostrarToast } = useToast();

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
    onChange(limpo);
  }

  async function handleRemover() {
    const ok = await confirmar({
      titulo: `Remove ${nomeServico} link`,
      mensagem: `Remove the ${nomeServico} link from this work?`,
      confirmarRotulo: 'Remove',
      perigoso: true,
    });
    if (!ok) return;
    onChange(null);
  }

  const pressHandlers = useLongPress({
    onClick: () => {
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      else void handleAdicionar();
    },
    onLongPress: () => {
      if (url) void handleRemover();
      else void handleAdicionar();
    },
  });

  return (
    <button
      type="button"
      className={`btn-icone link-externo-botao ${url ? '' : 'link-externo-vazio'}`}
      aria-label={url ? `Open on ${nomeServico}` : `Add ${nomeServico} link`}
      title={nomeServico}
      {...pressHandlers}
    >
      <IconeColorido arquivo={icone} />
    </button>
  );
}
