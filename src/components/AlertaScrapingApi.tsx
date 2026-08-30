import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  CHAVE_ALERTA_SCRAPING_API,
  interpretarAlerta,
  type AlertaScrapingApi,
} from '../lib/scrapingApiAlerta';

/** Lê o alerta do Supabase. Erro/linha ausente viram null — o aviso some, não quebra a tela. */
async function carregarAlerta(): Promise<AlertaScrapingApi | null> {
  const { data, error } = await supabase
    .from('configuracoes_scraper')
    .select('valor')
    .eq('chave', CHAVE_ALERTA_SCRAPING_API)
    .maybeSingle();
  if (error || !data) return null;
  return interpretarAlerta(data.valor);
}

/** Data/hora local da detecção, ou vazio. */
function formatarDeteccao(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Aviso de que as chaves das APIs de scraping precisam voltar.
 *
 * Elas estão em stand-by (SCRAPING_API_STANDBY nos workflows): o caminho pago
 * continua no código, mas não é tentado, porque os sites que dependiam dele
 * voltaram a responder no acesso direto. O risco de desligar assim é o scraper
 * parar em silêncio se o bloqueio voltar — este banner é o que fecha esse
 * buraco. Só aparece quando uma run registrou bloqueio direto num domínio
 * configurado; no estado normal não renderiza nada.
 */
export function AlertaScrapingApi() {
  const [alerta, setAlerta] = useState<AlertaScrapingApi | null>(null);

  useEffect(() => {
    let cancelado = false;
    carregarAlerta()
      .then((a) => {
        if (!cancelado) setAlerta(a);
      })
      .catch(() => {
        /* aviso é diagnóstico: falha ao ler não pode atrapalhar a tela */
      });
    return () => {
      cancelado = true;
    };
  }, []);

  if (!alerta) return null;

  return (
    <div className="alerta-scraping-api" role="alert">
      <strong className="alerta-scraping-api-titulo">Scraping API keys need renewing</strong>
      <p className="alerta-scraping-api-texto">
        {alerta.hosts.join(', ')} {alerta.hosts.length === 1 ? 'is' : 'are'} blocking direct access again, so the
        scraper can't read {alerta.hosts.length === 1 ? 'it' : 'them'} without the paid providers. Renew the
        ScraperAPI / ScrapingBee / scrape.do secrets and remove <code>SCRAPING_API_STANDBY</code> from the scraper
        workflows to switch the paid path back on.
        {alerta.detectadoEm && <> Detected {formatarDeteccao(alerta.detectadoEm)}.</>}
      </p>
    </div>
  );
}
