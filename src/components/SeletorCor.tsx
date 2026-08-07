import { useEffect, useRef, useState } from 'react';
import iro from '@jaames/iro';
import '../styles/seletor-cor.css';

const COR_INICIAL = '#f3f4f6';
const LS_KEY = 'testes-swatches';

interface SeletorCorProps {
  /** Chamado sempre que a cor muda (hex com #, ex: "#ff0000"). */
  onCorChange: (hex: string) => void;
}

interface SwatchCustom {
  id: string;
  hex: string;
  label: string;
}

const APP_CORES: { cssVar: string; label: string }[] = [
  { cssVar: '--text-h', label: '--text-h' },
  { cssVar: '--text', label: '--text' },
  { cssVar: '--bg', label: '--bg' },
  { cssVar: '--bg-raised', label: '--bg-raised' },
  { cssVar: '--border', label: '--border' },
  { cssVar: '--accent', label: '--accent' },
  { cssVar: '--danger', label: '--danger' },
  { cssVar: '--ok', label: '--ok' },
  { cssVar: '--warn', label: '--warn' },
];

function lerCssVar(cssVar: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
}

export function SeletorCor(props: SeletorCorProps) {
  const [aberto, setAberto] = useState(false);
  const [corHex, setCorHex] = useState(COR_INICIAL);
  const [painelAberto, setPainelAberto] = useState(false);
  const [grupoAppAberto, setGrupoAppAberto] = useState(false);
  const [grupoCustomAberto, setGrupoCustomAberto] = useState(false);
  const [swatchesCustom, setSwatchesCustom] = useState<SwatchCustom[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]');
    } catch {
      return [];
    }
  });
  const [labelNovo, setLabelNovo] = useState('');
  const [swatchInfo, setSwatchInfo] = useState<{ hex: string; label: string } | null>(null);

  const pickerContainerRef = useRef<HTMLDivElement>(null);
  const colorPickerRef = useRef<iro.ColorPicker | null>(null);
  const atualizandoRef = useRef(false);

  useEffect(() => {
    const container = pickerContainerRef.current;
    if (!aberto || !container) return;
    if (colorPickerRef.current) return;

    const picker = iro.ColorPicker(container, {
      width: 220,
      color: corHex,
      layout: [{ component: iro.ui.Wheel }, { component: iro.ui.Slider }],
    });

    picker.on('color:change', (color: iro.Color) => {
      if (atualizandoRef.current) return;
      atualizandoRef.current = true;
      setCorHex(color.hexString);
      props.onCorChange(color.hexString);
      setSwatchInfo(null);
      atualizandoRef.current = false;
    });

    colorPickerRef.current = picker;

    return () => {
      container.innerHTML = '';
      colorPickerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  function aplicarHex(hex: string) {
    if (atualizandoRef.current) return;
    atualizandoRef.current = true;
    setCorHex(hex);
    props.onCorChange(hex);
    if (colorPickerRef.current) {
      colorPickerRef.current.color.hexString = hex;
    }
    atualizandoRef.current = false;
  }

  function onHexInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setCorHex(val);
    setSwatchInfo(null);
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      aplicarHex(val);
    }
  }

  function onSwatchClick(hex: string, label: string) {
    aplicarHex(hex);
    setSwatchInfo({ hex, label });
  }

  function salvarSwatches(lista: SwatchCustom[]) {
    setSwatchesCustom(lista);
    localStorage.setItem(LS_KEY, JSON.stringify(lista));
  }

  function adicionarSwatch() {
    const novo: SwatchCustom = {
      id: crypto.randomUUID(),
      hex: corHex,
      label: labelNovo.trim(),
    };
    salvarSwatches([...swatchesCustom, novo]);
    setLabelNovo('');
  }

  function removerSwatch(id: string) {
    salvarSwatches(swatchesCustom.filter((s) => s.id !== id));
  }

  return (
    <div className="seletor-cor">
      <div className="seletor-cor-linha">
        <button
          type="button"
          className="seletor-cor-trigger"
          style={{ background: corHex }}
          onClick={() => setAberto((v) => !v)}
          title={aberto ? 'Close color picker' : 'Open color picker'}
          aria-expanded={aberto}
        />

        <input
          type="text"
          className="seletor-cor-hex-input"
          value={corHex}
          onChange={onHexInputChange}
          maxLength={7}
          spellCheck={false}
          aria-label="Hex color"
        />

        <button
          type="button"
          className="btn-icone seletor-cor-engrenagem"
          onClick={() => setPainelAberto((v) => !v)}
          title="Manage swatches"
          aria-expanded={painelAberto}
        >
          <IconeEngrenagem />
        </button>
      </div>

      {swatchInfo && (
        <div className="seletor-cor-swatch-info">
          <span className="seletor-cor-swatch-label">{swatchInfo.label || swatchInfo.hex}</span>
          <button
            type="button"
            className="btn-icone"
            title="Copy hex"
            onClick={() => void navigator.clipboard.writeText(swatchInfo.hex)}
          >
            <IconeCopiar />
          </button>
        </div>
      )}

      <div className="seletor-cor-swatches">
        {APP_CORES.map((ac) => {
          const hex = lerCssVar(ac.cssVar);
          return (
            <button
              key={ac.cssVar}
              type="button"
              className="seletor-cor-swatch seletor-cor-swatch-app"
              style={{ background: hex }}
              onClick={() => onSwatchClick(hex, ac.label)}
              title={ac.label}
            />
          );
        })}
        {swatchesCustom.map((sw) => (
          <button
            key={sw.id}
            type="button"
            className="seletor-cor-swatch seletor-cor-swatch-custom"
            style={{ background: sw.hex }}
            onClick={() => onSwatchClick(sw.hex, sw.label || sw.hex)}
            title={sw.label || sw.hex}
          />
        ))}
      </div>

      {aberto && (
        <div className="seletor-cor-picker-wrap">
          <div ref={pickerContainerRef} />
        </div>
      )}

      {painelAberto && (
        <div className="seletor-cor-painel">
          <div className="seletor-cor-grupo">
            <button
              type="button"
              className="seletor-cor-grupo-header"
              onClick={() => setGrupoAppAberto((v) => !v)}
              aria-expanded={grupoAppAberto}
            >
              <IconeChevron aberto={grupoAppAberto} />
              App colors
            </button>
            {grupoAppAberto && (
              <ul className="seletor-cor-grupo-lista">
                {APP_CORES.map((ac) => {
                  const hex = lerCssVar(ac.cssVar);
                  return (
                    <li key={ac.cssVar} className="seletor-cor-painel-item">
                      <span className="seletor-cor-swatch seletor-cor-swatch-app" style={{ background: hex }} />
                      <span className="seletor-cor-painel-hex">{hex}</span>
                      <span className="seletor-cor-painel-label">{ac.label}</span>
                      <button
                        type="button"
                        className="btn-icone"
                        title="Copy hex"
                        onClick={() => void navigator.clipboard.writeText(hex)}
                      >
                        <IconeCopiar />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="seletor-cor-grupo">
            <button
              type="button"
              className="seletor-cor-grupo-header"
              onClick={() => setGrupoCustomAberto((v) => !v)}
              aria-expanded={grupoCustomAberto}
            >
              <IconeChevron aberto={grupoCustomAberto} />
              My colors
            </button>
            {grupoCustomAberto && (
              <>
                <ul className="seletor-cor-grupo-lista">
                  {swatchesCustom.length === 0 && (
                    <li className="seletor-cor-painel-vazio">No saved colors yet.</li>
                  )}
                  {swatchesCustom.map((sw) => (
                    <li key={sw.id} className="seletor-cor-painel-item">
                      <span className="seletor-cor-swatch seletor-cor-swatch-custom" style={{ background: sw.hex }} />
                      <span className="seletor-cor-painel-hex">{sw.hex}</span>
                      <span className="seletor-cor-painel-label">{sw.label}</span>
                      <button
                        type="button"
                        className="btn-icone"
                        title="Copy hex"
                        onClick={() => void navigator.clipboard.writeText(sw.hex)}
                      >
                        <IconeCopiar />
                      </button>
                      <button
                        type="button"
                        className="btn-icone btn-icone-perigo"
                        title="Remove"
                        onClick={() => removerSwatch(sw.id)}
                      >
                        <IconeX />
                      </button>
                    </li>
                  ))}
                </ul>

                <div className="seletor-cor-adicionar">
                  <span className="seletor-cor-swatch" style={{ background: corHex }} />
                  <span className="seletor-cor-adicionar-hex">{corHex}</span>
                  <input
                    type="text"
                    className="seletor-cor-adicionar-label"
                    placeholder="Label (optional)"
                    value={labelNovo}
                    onChange={(e) => setLabelNovo(e.target.value)}
                    maxLength={40}
                  />
                  <button type="button" onClick={adicionarSwatch}>
                    Add
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function IconeEngrenagem() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconeCopiar() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function IconeX() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function IconeChevron({ aberto }: { aberto: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: aberto ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
