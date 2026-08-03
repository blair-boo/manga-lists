import { useRef, useState, type ChangeEvent } from 'react';
import { deletarCapaAntigaSeDiferente } from '../lib/capaStorage';
import { uploadCapa } from '../lib/uploadCapa';
import type { Tipo } from '../types';

/**
 * Lógica de upload de capa isolada do markup: quem chama espalha `inputProps`
 * num `<input type="file">` próprio e usa `abrirSeletor` pra disparar o
 * seletor de arquivo do sistema a partir de qualquer elemento clicável (a
 * miniatura da tela da obra, o card do Edit mode da lista, etc.).
 */
export function useUploadCapa({
  titulo,
  tipo,
  capaAtual,
  onUploaded,
}: {
  titulo: string;
  tipo: Tipo | null;
  /** Capa antes desta troca, pra apagar o arquivo antigo do Storage se o path mudar. */
  capaAtual: string | null;
  onUploaded: (url: string) => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function abrirSeletor() {
    if (enviando) return;
    if (!titulo.trim()) {
      setErro('Fill in the title before uploading a cover.');
      return;
    }
    setErro(null);
    inputRef.current?.click();
  }

  async function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setEnviando(true);
    setErro(null);
    try {
      const url = await uploadCapa(file, titulo, tipo);
      try {
        await deletarCapaAntigaSeDiferente(capaAtual, url);
      } catch {
        // Best-effort: a capa nova já está gravada e funcionando: um órfão
        // que sobrou no Storage não afeta a usuária, não vale um erro aqui.
      }
      onUploaded(url);
    } catch {
      setErro('Failed to upload image.');
    } finally {
      setEnviando(false);
    }
  }

  return {
    enviando,
    erro,
    abrirSeletor,
    inputProps: { ref: inputRef, type: 'file' as const, accept: 'image/*', hidden: true, onChange: handleChange },
  };
}

/**
 * Capa clicável (Handout 3, Bloco B): a própria miniatura (ou o placeholder "+"
 * quando não há capa) dispara o seletor de arquivo do sistema — sem botão
 * "Upload image" nem input de URL.
 */
export function CapaUploader({
  capaUrl,
  titulo,
  tipo,
  onUploaded,
}: {
  capaUrl: string | null;
  titulo: string;
  tipo: Tipo | null;
  onUploaded: (url: string) => void;
}) {
  const { enviando, erro, abrirSeletor, inputProps } = useUploadCapa({ titulo, tipo, capaAtual: capaUrl, onUploaded });

  return (
    <div className="capa-uploader">
      {capaUrl ? (
        <img
          src={capaUrl}
          alt="Cover"
          className={`capa-preview${enviando ? ' enviando' : ''}`}
          onClick={abrirSeletor}
          role="button"
          aria-label="Change cover"
        />
      ) : (
        <div
          className={`capa-preview-vazia${enviando ? ' enviando' : ''}`}
          onClick={abrirSeletor}
          role="button"
          aria-label="Add cover"
        >
          +
        </div>
      )}
      <input {...inputProps} />
      {erro && <span className="upload-erro">{erro}</span>}
    </div>
  );
}
