// SVGs inline reutilizados (Blocos E e F): disquete (salvar), X (cancelar),
// grip/tracinhos (handle de arraste e botão de editar ordem). Sem biblioteca
// de ícones só pra isso. currentColor herda a cor do botão.

import { supabase } from '../lib/supabaseClient';

const ICONS_BUCKET = 'icons';
const TAMANHO_ICONE_SUPABASE = 20;

function urlIconeSupabase(arquivo: string): string {
  return supabase.storage.from(ICONS_BUCKET).getPublicUrl(arquivo).data.publicUrl;
}

/** Ícone "pintado" via mask (mesma técnica da aba Tests): puxa o SVG do
 * Supabase Storage (bucket "icons") e usa currentColor pra seguir o tema/botão. */
function IconeMascarado({ arquivo }: { arquivo: string }) {
  const url = urlIconeSupabase(arquivo);
  return (
    <span
      className="icone-mascarado"
      aria-hidden
      style={{
        width: TAMANHO_ICONE_SUPABASE,
        height: TAMANHO_ICONE_SUPABASE,
        WebkitMaskImage: `url(${url})`,
        maskImage: `url(${url})`,
      }}
    />
  );
}

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

/** Livrinho — indicador de obra vinculada ao Novel Updates (Bloco E7).
 * SVG fornecido pela usuária (Supabase storage icons/book-stars-fill.svg), 20px fixo. */
export function IconeLivro() {
  return <IconeMascarado arquivo="book-stars-fill.svg" />;
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

/** Obra correspondente (manga<->novel) — SVG fornecido pela usuária (Supabase
 * storage icons/corresponding-work.svg), 20px fixo, colorido via mask. */
export function IconeTrocar() {
  return <IconeMascarado arquivo="corresponding-work.svg" />;
}

/** Limpar filtros — SVG fornecido pela usuária (Supabase storage
 * icons/clear_filter.svg), 20px fixo, colorido via mask. */
export function IconeLimparFiltros() {
  return <IconeMascarado arquivo="clear_filter.svg" />;
}

/**
 * Ícone do Supabase Storage renderizado como <img>, preservando as cores do
 * arquivo. Usar quando o SVG tem cor própria que NÃO deve seguir o tema
 * (caso do rato do Edit mode, que mantém o vermelho). Para ícones que devem
 * acompanhar o tema, usar IconeMascarado.
 */
function IconeColorido({ arquivo, largura, altura }: { arquivo: string; largura: number; altura: number }) {
  return (
    <img
      className="icone-colorido"
      src={urlIconeSupabase(arquivo)}
      width={largura}
      height={altura}
      alt=""
      aria-hidden
      draggable={false}
    />
  );
}

// Nomes dos arquivos no bucket "icons". São PNG (não SVG como os demais
// ícones): é o formato em que a dona subiu os dois ratos. Como IconeColorido
// usa <img>, o formato não faz diferença aqui.
const ARQUIVO_MODO_EDICAO = 'mini-mouse-inverted.png';
const ARQUIVO_SAIR_MODO_EDICAO = 'mini-mouse-no-inverted.png';

const RATO_LARGURA = 20;
const RATO_ALTURA = 30;

/** Rato: entrar no Edit mode da aba List. */
export function IconeModoEdicao() {
  return <IconeColorido arquivo={ARQUIVO_MODO_EDICAO} largura={RATO_LARGURA} altura={RATO_ALTURA} />;
}

/** Rato riscado: sair do Edit mode (usado no header e no botão flutuante). */
export function IconeSairModoEdicao() {
  return <IconeColorido arquivo={ARQUIVO_SAIR_MODO_EDICAO} largura={RATO_LARGURA} altura={RATO_ALTURA} />;
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
