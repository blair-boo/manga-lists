import { useEffect, useState } from 'react';
import {
  getMatchConfig,
  setMatchConfig,
  MATCH_CONFIG_PADRAO,
  type LimiaresOperacao,
  type MatchConfig,
} from '../lib/scraperConfig';
import { useToast } from './Toast';

const OPERACOES: { chave: keyof MatchConfig; rotulo: string }[] = [
  { chave: 'atualizar_obras', rotulo: 'Update works' },
  { chave: 'buscar_novas_fontes', rotulo: 'Find new sources' },
];

export function ConfigMatchTitulo() {
  const { mostrarToast } = useToast();
  const [config, setConfig] = useState<MatchConfig | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    getMatchConfig()
      .then(setConfig)
      .catch(() => setConfig(MATCH_CONFIG_PADRAO));
  }, []);

  if (!config) return <p className="execucao-status">Loading settings…</p>;

  function setCampo(op: keyof MatchConfig, chave: keyof LimiaresOperacao, valor: string) {
    const n = valor === '' ? 0 : Number(valor);
    setConfig((c) => (c ? { ...c, [op]: { ...c[op], [chave]: n } } : c));
  }

  async function salvar() {
    if (!config) return;
    setSalvando(true);
    try {
      await setMatchConfig(config);
      mostrarToast('Settings saved ✓');
    } catch {
      mostrarToast('Failed to save settings', 'erro');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="config-match">
      <p>
        Title-similarity thresholds (0–1) that decide what a scraper does with a match:{' '}
        <strong>auto-approve</strong> at or above the first, <strong>send to review</strong> at or above the second,
        discard below it.
      </p>

      <div className="config-match-grupos">
        {OPERACOES.map(({ chave, rotulo }) => (
          <fieldset key={chave} className="config-match-grupo">
            <legend>{rotulo}</legend>
            <label>
              Auto-approve ≥
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={config[chave].limiar_auto_aprovacao}
                onChange={(e) => setCampo(chave, 'limiar_auto_aprovacao', e.target.value)}
              />
            </label>
            <label>
              Send to review ≥
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={config[chave].limiar_minimo_pendencia}
                onChange={(e) => setCampo(chave, 'limiar_minimo_pendencia', e.target.value)}
              />
            </label>
          </fieldset>
        ))}
      </div>

      <button type="button" onClick={salvar} disabled={salvando}>
        {salvando ? 'Saving…' : 'Save settings'}
      </button>
    </div>
  );
}
