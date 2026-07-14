import { useState, type ChangeEvent } from 'react';
import { uploadCapa } from '../lib/uploadCapa';

export function CapaUploader({ onUploaded }: { onUploaded: (url: string) => void }) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

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
      <label className="upload-capa-botao">
        <input type="file" accept="image/*" onChange={handleChange} disabled={enviando} />
        {enviando ? 'Uploading…' : 'Upload image'}
      </label>
      {erro && <span className="upload-erro">{erro}</span>}
    </div>
  );
}
