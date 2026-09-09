import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import {
  getMatchConfig,
  setMatchConfig,
  MATCH_CONFIG_PADRAO,
  type LimiaresOperacao,
  type MatchConfig,
} from '../lib/scraperConfig';
import { IconeSalvar } from './Icones';
import { useToast } from './Toast';

// 'conciliacao_csv' não entra aqui: seu fieldset mora em ConciliacaoSitesSection
// (Related sites reconciliation), logo abaixo do botão de upload — mais perto de
// onde o limiar realmente se aplica. O valor continua no mesmo MatchConfig
// salvo por setMatchConfig, só a UI de edição é que fica noutra tela.
const OPERACOES: { chave: keyof MatchConfig; rotulo: string }[] = [
  { chave: 'atualizar_obras', rotulo: 'Update works' },
  { chave: 'buscar_novas_fontes', rotulo: 'Find new sources' },
];

/** Um fieldset de limiares (auto-approve / send to review) pra uma única operação — reusado
 * por ConfigMatchTitulo (Update works/Find new sources) e pelo Match Settings de
 * ConciliacaoSitesSection (conciliacao_csv). */
export function LimiaresFieldset({
  titulo,
  icone,
  valor,
  onChange,
  children,
}: {
  titulo: string;
  icone?: ReactNode;
  valor: LimiaresOperacao;
  onChange: (chave: keyof LimiaresOperacao, valor: string) => void;
  children?: ReactNode;
}) {
  return (
    <fieldset className="config-match-grupo">
      <legend>
        {icone}
        {titulo}
      </legend>
      <label>
        Auto-approve ≥
        <input
          type="number"
          step="0.01"
          min="0"
          max="1"
          value={valor.limiar_auto_aprovacao}
          onChange={(e) => onChange('limiar_auto_aprovacao', e.target.value)}
        />
      </label>
      <label>
        Send to review ≥
        <input
          type="number"
          step="0.01"
          min="0"
          max="1"
          value={valor.limiar_minimo_pendencia}
          onChange={(e) => onChange('limiar_minimo_pendencia', e.target.value)}
        />
      </label>
      {children}
    </fieldset>
  );
}

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
          <LimiaresFieldset
            key={chave}
            titulo={rotulo}
            valor={config[chave]}
            onChange={(campo, valor) => setCampo(chave, campo, valor)}
          />
        ))}
      </div>

      <button
        type="button"
        className="btn-icone"
        onClick={salvar}
        disabled={salvando}
        aria-label={salvando ? 'Saving…' : 'Save settings'}
        title={salvando ? 'Saving…' : 'Save settings'}
      >
        <IconeSalvar />
      </button>
    </div>
  );
}
