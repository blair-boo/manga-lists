// SVGs inline reutilizados (Blocos E e F): disquete (salvar), X (cancelar),
// grip/tracinhos (handle de arraste e botão de editar ordem). Sem biblioteca
// de ícones só pra isso. currentColor herda a cor do botão.

import { useEffect, useState } from 'react';
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

// Cache module-level do texto dos SVGs buscados do Storage — os dois ratos
// aparecem em vários lugares ao mesmo tempo (header, botão flutuante) e não
// precisam refazer o fetch a cada montagem.
const cacheSvgTexto = new Map<string, Promise<string>>();

function buscarSvgTexto(arquivo: string): Promise<string> {
  let pendente = cacheSvgTexto.get(arquivo);
  if (!pendente) {
    pendente = fetch(urlIconeSupabase(arquivo)).then((r) => r.text());
    cacheSvgTexto.set(arquivo, pendente);
  }
  return pendente;
}

/**
 * Ícone do Supabase Storage injetado INLINE no DOM (não via <img>), pra cores
 * `currentColor`/`fill="currentcolor"` dentro do arquivo herdarem a cor do
 * elemento ao redor — um <img src="..."> isola o SVG num documento próprio,
 * sem acesso ao `color` CSS de fora, então currentColor nunca funcionaria ali.
 * Usar quando o SVG precisa acompanhar o tema em PARTE do desenho e manter
 * outra parte com cor fixa (o rato riscado do Edit mode: corpo no tema,
 * "proibido" sempre vermelho). Pra um ícone de cor fixa POR INTEIRO sem
 * nenhuma parte no tema, IconeMascarado é mais simples.
 *
 * dangerouslySetInnerHTML é seguro aqui: o conteúdo vem do bucket "icons" da
 * própria dona (não é upload de usuário nem dado de terceiro).
 */
function IconeSvgInline({ arquivo, largura, altura }: { arquivo: string; largura: number; altura: number }) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    void buscarSvgTexto(arquivo).then((texto) => {
      if (cancelado) return;
      // Defensivo: "current color" (com espaço) não é uma cor CSS válida —
      // normaliza pra currentColor. "currentcolor" (minúsculo, sem espaço) já
      // é válido (palavras-chave CSS não diferenciam maiúscula/minúscula).
      setSvg(texto.replace(/current\s*color/gi, 'currentColor'));
    });
    return () => {
      cancelado = true;
    };
  }, [arquivo]);

  return (
    <span
      className="icone-svg-inline"
      aria-hidden
      style={{ width: largura, height: altura }}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}

// Nomes dos arquivos no bucket "icons".
const ARQUIVO_MODO_EDICAO = 'mini-mouse-inverted.svg';
const ARQUIVO_SAIR_MODO_EDICAO = 'mini-mouse-no-inverted.svg';

const RATO_LARGURA = 20;
const RATO_ALTURA = 30;

/** Rato: entrar no Edit mode da aba List. */
export function IconeModoEdicao() {
  return <IconeSvgInline arquivo={ARQUIVO_MODO_EDICAO} largura={RATO_LARGURA} altura={RATO_ALTURA} />;
}

/** Rato riscado: sair do Edit mode (usado no header e no botão flutuante). */
export function IconeSairModoEdicao() {
  return <IconeSvgInline arquivo={ARQUIVO_SAIR_MODO_EDICAO} largura={RATO_LARGURA} altura={RATO_ALTURA} />;
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
