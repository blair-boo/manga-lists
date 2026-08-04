import { useDialogos } from './Dialogo';
import { useToast } from './Toast';
import { IconeLivro, IconeMais, IconeX } from './Icones';

interface LinkExternoProps {
  /** Rótulo curto exibido na tela (AL, MAL, MU, MD, MB, NU). */
  rotulo: string;
  /** Nome do serviço usado nos textos de diálogo/toast (AniList, Novel Updates…). */
  nomeServico: string;
  url: string | null;
  /** Host esperado da URL colada — rejeita e avisa se não bater (mesmo padrão do handleAdicionarNU). */
  hostEsperado: RegExp;
  onChange: (url: string | null) => void;
}

/**
 * Campo de link externo (ícone de livrinho que abre em nova aba + × pra
 * remover, ou + pra adicionar quando vazio). Parametrizado pra cobrir os
 * cinco links de catálogo (AniList/MyAnimeList/MangaUpdates/MangaDex/
 * MangaBaka) e o Novel Updates com o mesmo componente (handout comix, E7).
 */
export function LinkExterno({ rotulo, nomeServico, url, hostEsperado, onChange }: LinkExternoProps) {
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
    });
    if (!ok) return;
    onChange(null);
  }

  return (
    <div className="link-externo-campo">
      <span className="link-externo-label">{rotulo}:</span>
      <div className="link-externo-acoes">
        {url ? (
          <>
            <a
              className="btn-icone"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open on ${nomeServico}`}
              title={`Open on ${nomeServico}`}
            >
              <IconeLivro />
            </a>
            <button
              type="button"
              className="btn-icone btn-icone-perigo"
              onClick={handleRemover}
              aria-label={`Remove ${nomeServico} link`}
              title="Remove"
            >
              <IconeX />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn-icone"
            onClick={handleAdicionar}
            aria-label={`Add ${nomeServico} link`}
            title={`Add ${nomeServico} link`}
          >
            <IconeMais />
          </button>
        )}
      </div>
    </div>
  );
}
