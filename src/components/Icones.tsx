// SVGs inline reutilizados (Blocos E e F): disquete (salvar), X (cancelar),
// grip/tracinhos (handle de arraste e botão de editar ordem). Sem biblioteca
// de ícones só pra isso. currentColor herda a cor do botão.

const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function IconeDisquete() {
  return (
    <svg {...base}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </svg>
  );
}

export function IconeX() {
  return (
    <svg {...base}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

/** Três tracinhos horizontais — botão de editar ordem e handle de arraste. */
export function IconeGrip() {
  return (
    <svg {...base}>
      <path d="M3 6h18" />
      <path d="M3 12h18" />
      <path d="M3 18h18" />
    </svg>
  );
}

/** Livrinho — indicador de obra vinculada ao Novel Updates (Bloco E7). */
export function IconeLivro() {
  return (
    <svg {...base}>
      <path d="M4 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2z" />
      <path d="M4 19a2 2 0 0 0 2 2h12" />
    </svg>
  );
}

/** "+" — adicionar (vínculo manual de Novel Updates, Bloco E7). */
export function IconeMais() {
  return (
    <svg {...base}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

/** Moldura de imagem — placeholder da capa vazia. */
export function IconeImagem() {
  return (
    <svg {...base} width={28} height={28}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}
