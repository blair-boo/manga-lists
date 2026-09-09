// SVGs inline reutilizados (Blocos E e F): X (cancelar), grip/tracinhos
// (handle de arraste e botão de editar ordem). Sem biblioteca de ícones só
// pra isso. currentColor herda a cor do botão.

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
 * icons/filter-clear.svg), 20px fixo, colorido via mask. */
export function IconeLimparFiltros() {
  return <IconeMascarado arquivo="filter-clear.svg" />;
}

/** Mostrar filtros (painel fechado) — Supabase storage icons/filter+.svg. */
export function IconeFiltros() {
  return <IconeMascarado arquivo="filter+.svg" />;
}

/** Esconder filtros (painel aberto) — Supabase storage icons/filter-.svg. */
export function IconeEsconderFiltros() {
  return <IconeMascarado arquivo="filter-.svg" />;
}

/** Lixeira — excluir obra ("Delete work") e "Discard and leave" nos modais
 * de alterações não salvas. Supabase storage icons/trash3.svg. */
export function IconeLixeira() {
  return <IconeMascarado arquivo="trash3.svg" />;
}

/** Vassoura — descartar alterações (Genres/Tags). Supabase storage
 * icons/broomstick.svg. */
export function IconeDescartar() {
  return <IconeMascarado arquivo="broomstick.svg" />;
}

/** Salvar — todos os botões "Save" do app. Supabase storage icons/save2.svg. */
export function IconeSalvar() {
  return <IconeMascarado arquivo="save2.svg" />;
}

/** Prefixo dos títulos "Match Settings". Supabase storage
 * icons/match-settings.svg. */
export function IconeMatchSettings() {
  return <IconeMascarado arquivo="match-settings.svg" />;
}

/** Prefixo dos títulos/chips de "Blacklist" (distinto do IconeBlacklist
 * abaixo, usado no botão de ação "Blacklist domain"). Supabase storage
 * icons/blacklist-icon.svg. */
export function IconeBlacklistTitulo() {
  return <IconeMascarado arquivo="blacklist-icon.svg" />;
}

/** Alternar pra visualização em grade (Lista Principal). Supabase storage
 * icons/menu-grid3.svg. */
export function IconeGradeView() {
  return <IconeMascarado arquivo="menu-grid3.svg" />;
}

/** Alternar pra visualização em lista (Lista Principal). Supabase storage
 * icons/menu-list.svg. */
export function IconeListaView() {
  return <IconeMascarado arquivo="menu-list.svg" />;
}

/** Recarregar — botão "Refresh icons" da aba Tests (Supabase storage
 * icons/refresh.svg), 20px fixo, colorido via mask. */
export function IconeRefresh() {
  return <IconeMascarado arquivo="refresh.svg" />;
}

/** Embaralhar/aleatório — botão de ordem aleatória (Lista Principal) e de obra
 * aleatória (tela da obra), SVG fornecido pela usuária (Supabase storage
 * icons/infinite-border-icon.svg), 20px fixo, colorido via mask. */
export function IconeEmbaralhar() {
  return <IconeMascarado arquivo="infinite-border-icon.svg" />;
}

/** Aprovar — fila de aprovações de scraper (Supabase storage icons/approve.svg). */
export function IconeAprovar() {
  return <IconeMascarado arquivo="approve.svg" />;
}

/** Blacklist ("proibido") — fila de aprovações de scraper. */
export function IconeBlacklist() {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.5 5.5 13 13" />
    </svg>
  );
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

/** Defensivo: "current color" (com espaço) não é uma cor CSS válida — normaliza
 * pra currentColor. "currentcolor" (minúsculo, sem espaço) já é válido
 * (palavras-chave CSS não diferenciam maiúscula/minúscula). */
export function normalizarSvgCurrentColor(texto: string): string {
  return texto.replace(/current\s*color/gi, 'currentColor');
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
      setSvg(normalizarSvgCurrentColor(texto));
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

const RATO_ENTRAR_TAMANHO = 30;
const RATO_SAIR_TAMANHO = 40;

/** Rato: entrar no Edit mode da aba List. */
export function IconeModoEdicao() {
  return <IconeSvgInline arquivo={ARQUIVO_MODO_EDICAO} largura={RATO_ENTRAR_TAMANHO} altura={RATO_ENTRAR_TAMANHO} />;
}

/** Rato riscado: sair do Edit mode (usado no header e no botão flutuante). */
export function IconeSairModoEdicao() {
  return <IconeSvgInline arquivo={ARQUIVO_SAIR_MODO_EDICAO} largura={RATO_SAIR_TAMANHO} altura={RATO_SAIR_TAMANHO} />;
}

/** Sparkle — botão de favoritar (lista e página da obra). Colorido via
 * currentColor: cinza no estado inativo, #FECC01 no ativo (CSS). */
export function IconeSparkle() {
  return <IconeMascarado arquivo="sparkle.svg" />;
}

const ARQUIVO_VOLTAR_TOPO = 'w-color/star-up-f5ae0a.svg';
const VOLTAR_TOPO_TAMANHO = 40;

/** Seta "voltar ao topo" (lista): SVG com duas cores — amarelo fixo embutido
 * no arquivo + currentColor pro resto, que herda a cor do botão (--text-h,
 * via .btn-icone) e assim acompanha o tema claro/escuro. Precisa ser inline
 * (não <img>, que isola o SVG e mata o currentColor) — mesma técnica do rato. */
export function IconeVoltarTopo() {
  return <IconeSvgInline arquivo={ARQUIVO_VOLTAR_TOPO} largura={VOLTAR_TOPO_TAMANHO} altura={VOLTAR_TOPO_TAMANHO} />;
}

/** Ícone com cor PRÓPRIA (arquivo já colorido no Storage, pasta w-color/) —
 * renderizado via <img> em vez de mask, pra não perder a cor original. Fica
 * acinzentado (via filtro CSS, classe do botão pai) quando não há link. */
export function IconeColorido({ arquivo, tamanho = 20 }: { arquivo: string; tamanho?: number }) {
  return <img className="icone-colorido" src={urlIconeSupabase(arquivo)} alt="" width={tamanho} height={tamanho} loading="lazy" />;
}

/** Copiar — botão de copiar o título pro clipboard (Edit mode, linha do título). */
export function IconeCopiar() {
  return (
    <svg {...base}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
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
