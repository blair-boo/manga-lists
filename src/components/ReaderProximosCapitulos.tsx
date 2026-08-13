import { formatarData, rotuloCapitulo } from '../lib/reader';
import type { ReaderCapitulo } from '../types';

/**
 * Capítulos presos no paywall, com a data em que caem. É o que responde
 * "vale a pena esperar?" sem abrir o site — por isso mostra a data concreta,
 * e não "em N dias" (que a varredura quinzenal deixaria desatualizado).
 */
export function ReaderProximosCapitulos({ capitulos }: { capitulos: ReaderCapitulo[] }) {
  if (capitulos.length === 0) return <span className="reader-vazio">—</span>;

  return (
    <ul className="reader-proximos">
      {capitulos.map((c) => (
        <li key={c.id}>
          <span className="reader-proximos-cap">{rotuloCapitulo(c)}</span>
          <span className="reader-proximos-data">{formatarData(c.disponivel_em)}</span>
        </li>
      ))}
    </ul>
  );
}
