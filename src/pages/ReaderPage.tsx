import { useState } from 'react';
import { AdicionarAoReader } from '../components/AdicionarAoReader';
import { ReaderLinhaObra } from '../components/ReaderLinhaObra';
import { ReaderPreviewModal } from '../components/ReaderPreviewModal';
import { useReader, type LinhaReader } from '../hooks/useReader';

/**
 * Painel do Reader: obras em andamento e concluídas.
 *
 * Uma página com duas seções (e não sub-abas) porque as duas listas são olhadas
 * juntas — a de andamento diz o que precisa de ação, a de concluídas é de onde
 * saem os arquivos.
 */
export function ReaderPage() {
  const { emAndamento, concluidas, carregando } = useReader();
  const [preview, setPreview] = useState<LinhaReader | null>(null);

  // O modal guarda a linha por id, não por referência: sem isso, editar dentro
  // do preview congelaria a tela nos dados de quando ele abriu.
  const linhaPreview =
    preview === null
      ? null
      : ([...emAndamento, ...concluidas].find((l) => l.reader.id === preview.reader.id) ?? null);

  if (carregando) return <p className="reader-vazio">Loading…</p>;

  return (
    <div className="reader-pagina">
      <section className="atualizacao-secao">
        <h2>In progress ({emAndamento.length})</h2>
        {emAndamento.length === 0 ? (
          <p className="reader-vazio">Nothing here yet. Add a novel below.</p>
        ) : (
          <ul className="reader-lista">
            {emAndamento.map((linha) => (
              <ReaderLinhaObra
                key={linha.reader.id}
                linha={linha}
                variante="andamento"
                onAbrirPreview={setPreview}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="atualizacao-secao">
        <h2>Completed ({concluidas.length})</h2>
        {concluidas.length === 0 ? (
          <p className="reader-vazio">No completed works yet.</p>
        ) : (
          <ul className="reader-lista">
            {concluidas.map((linha) => (
              <ReaderLinhaObra
                key={linha.reader.id}
                linha={linha}
                variante="concluida"
                onAbrirPreview={setPreview}
              />
            ))}
          </ul>
        )}
      </section>

      <AdicionarAoReader />

      <ReaderPreviewModal linha={linhaPreview} onFechar={() => setPreview(null)} />
    </div>
  );
}
