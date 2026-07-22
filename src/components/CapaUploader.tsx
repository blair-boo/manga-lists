import { useRef, useState, type ChangeEvent } from 'react';
import { uploadCapa } from '../lib/uploadCapa';

/**
 * Capa clicável (Handout 3, Bloco B): a própria miniatura (ou o placeholder "+"
 * quando não há capa) dispara o seletor de arquivo do sistema — sem botão
 * "Upload image" nem input de URL. Toda a lógica de upload (validação implícita
 * pelo accept, chamada ao Storage, estado de carregando/erro) fica aqui.
 */
export function CapaUploader({ capaUrl, onUploaded }: { capaUrl: string | null; onUploaded: (url: string) => void }) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function abrirSeletor() {
    if (!enviando) inputRef.current?.click();
  }

  async function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setEnviando(true);
    setErro(null);
    try {
      const url = await uploadCapa(file);
      onUploaded(url);
    } catch {
      setErro('Failed to upload image.');
    } finally {
      setEnviando(false);
    }
  }

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
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={handleChange} />
      {erro && <span className="upload-erro">{erro}</span>}
    </div>
  );
}
