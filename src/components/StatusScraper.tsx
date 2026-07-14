import type { Fonte } from '../types';

function formatarDataHora(iso: string | null): string {
  if (!iso) return 'never checked';
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
}

export function StatusScraper({ fonte, compact = false }: { fonte: Fonte; compact?: boolean }) {
  if (fonte.ultima_verificacao == null) {
    return (
      <span className="scraper-status scraper-nunca" title="Never checked by the scraper">
        —
      </span>
    );
  }
  const encontrou = fonte.ultimo_capitulo_detectado != null;
  return (
    <span
      className={`scraper-status ${encontrou ? 'scraper-ok' : 'scraper-falha'}`}
      title={formatarDataHora(fonte.ultima_verificacao)}
    >
      {encontrou ? '✓' : '✕'}
      {!compact && <span className="scraper-data">{formatarDataHora(fonte.ultima_verificacao)}</span>}
    </span>
  );
}
