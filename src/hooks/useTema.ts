import { useEffect, useState } from 'react';

export type TemaPref = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'tema';

function lerTemaSalvo(): TemaPref {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

function aplicarTema(pref: TemaPref) {
  const root = document.documentElement;
  if (pref === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', pref);
  }
}

/**
 * Preferência de tema (claro/escuro/sistema) persistida em localStorage.
 * No modo "system" a preferência do SO (@media prefers-color-scheme) vale;
 * caso contrário `data-theme` no <html> vence via CSS.
 */
export function useTema() {
  const [tema, setTemaState] = useState<TemaPref>(lerTemaSalvo);

  useEffect(() => {
    aplicarTema(tema);
  }, [tema]);

  function setTema(pref: TemaPref) {
    setTemaState(pref);
    localStorage.setItem(STORAGE_KEY, pref);
  }

  function ciclarTema() {
    setTema(tema === 'light' ? 'dark' : tema === 'dark' ? 'system' : 'light');
  }

  return { tema, setTema, ciclarTema };
}
