import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/localDb';
import { criarObraComFontes, updateFonte, updateObra, type NovaObra } from '../db/repo';
import { salvarCamposObra } from '../lib/salvarObra';
import { adicionarFonteNaObra } from '../lib/adicionarFonte';
import { adicionarValorLista } from '../lib/listas';
import { uploadCapa } from '../lib/uploadCapa';
import { deletarCapaAntigaSeDiferente } from '../lib/capaStorage';
import { normalizarTitulo } from '../lib/duplicatas';
import { buscarObraComix } from '../lib/comixFetch';
import { decodificarPayload, ehTituloLatino, type ComixObra } from '../lib/comix';
import { mensagemDeErro, mensagemErroComix } from '../lib/erros';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useListasPorCategoria } from '../hooks/useListas';
import { useToast } from '../components/Toast';
import { VinculoObraSelect } from '../components/VinculoObraSelect';
import type { Classificacao, Fonte, Obra } from '../types';

/** URL comparável sem barra final e sem query (Bloco E4, regra 2). */
function urlComparavel(url: string): string {
  return url.split('?')[0].replace(/\/+$/, '');
}

function encontrarObraPorFonteComix(fontes: Fonte[], obras: Obra[], hid: string): { obra: Obra } | null {
  const fonte = fontes.find((f) => urlComparavel(f.url).includes(`/title/${hid}`));
  if (!fonte) return null;
  const obra = obras.find((o) => o.id === fonte.obra_id);
  return obra ? { obra } : null;
}

function encontrarObraPorTitulo(obras: Obra[], comixObra: ComixObra): { obra: Obra } | null {
  const candidatos = new Set([comixObra.titulo, ...comixObra.titulosAlternativos].map(normalizarTitulo));
  for (const obra of obras) {
    const titulosObra = [obra.titulo, ...(obra.titulos_alternativos ?? [])].map(normalizarTitulo);
    if (titulosObra.some((t) => candidatos.has(t))) return { obra };
  }
  return null;
}

/** Separa valores do comix em "já conhecidos" (casam com um valor existente em
 * `listas`, devolvendo a grafia canônica) e "novos" (sem correspondência). */
function classificarValoresLista(valoresComix: string[], conhecidos: string[]): { conhecidos: string[]; novos: string[] } {
  const porNormalizado = new Map(conhecidos.map((c) => [normalizarTitulo(c), c]));
  const resultado = { conhecidos: [] as string[], novos: [] as string[] };
  const vistos = new Set<string>();
  for (const valor of valoresComix) {
    const norm = normalizarTitulo(valor);
    if (!norm || vistos.has(norm)) continue;
    vistos.add(norm);
    const match = porNormalizado.get(norm);
    if (match) resultado.conhecidos.push(match);
    else resultado.novos.push(valor);
  }
  return resultado;
}

interface AceitarLinks {
  al: boolean;
  mal: boolean;
  mu: boolean;
  md: boolean;
  mb: boolean;
}

const LINKS_INFO = [
  { chave: 'al' as const, rotulo: 'AniList', campo: 'anilist_url' as const },
  { chave: 'mal' as const, rotulo: 'MyAnimeList', campo: 'myanimelist_url' as const },
  { chave: 'mu' as const, rotulo: 'MangaUpdates', campo: 'mangaupdates_url' as const },
  { chave: 'md' as const, rotulo: 'MangaDex', campo: 'mangadex_url' as const },
  { chave: 'mb' as const, rotulo: 'MangaBaka', campo: 'mangabaka_url' as const },
];

export function ImportarComixPage() {
  const [searchParams] = useSearchParams();
  const obraIdParam = searchParams.get('obra');
  const navigate = useNavigate();
  const { mostrarToast } = useToast();

  const obrasRaw = useLiveQuery(() => db.obras.toArray(), []);
  const fontesRaw = useLiveQuery(() => db.fontes.toArray(), []);
  const generosConhecidos = useListasPorCategoria('genero');
  const tagsConhecidos = useListasPorCategoria('tag');

  const [comixObra, setComixObra] = useState<ComixObra | null>(null);
  const [urlInput, setUrlInput] = useState('');

  // Fragmento #d=... (extensão/bookmarklet, Bloco E3/G): lido uma vez, depois
  // limpo da barra de endereços pra não ficar no histórico.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith('#d=')) return;
    try {
      setComixObra(decodificarPayload(hash.slice(3)));
    } catch (err) {
      mostrarToast(mensagemDeErro(err), 'erro');
    }
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    executar: executarBusca,
    executando: buscando,
    erro: erroBusca,
  } = useAsyncAction(async () => {
    try {
      const obra = await buscarObraComix(urlInput);
      setComixObra(obra);
    } catch (err) {
      throw new Error(mensagemErroComix(err));
    }
  });

  // --- Resolução da obra de destino (Bloco E4) --------------------------------
  const [obraSelecionadaId, setObraSelecionadaId] = useState<string | null>(null);
  const [motivoMatch, setMotivoMatch] = useState<string | null>(null);
  const [modoNovaObra, setModoNovaObra] = useState(false);
  const [hidResolvido, setHidResolvido] = useState<string | null>(null);

  useEffect(() => {
    if (!comixObra || !obrasRaw || !fontesRaw) return;
    if (hidResolvido === comixObra.hid) return; // já resolvido pra este comixObra
    setHidResolvido(comixObra.hid);

    if (obraIdParam && obrasRaw.some((o) => o.id === obraIdParam)) {
      setObraSelecionadaId(obraIdParam);
      setMotivoMatch(null);
      return;
    }
    const porFonte = encontrarObraPorFonteComix(fontesRaw, obrasRaw, comixObra.hid);
    if (porFonte) {
      setObraSelecionadaId(porFonte.obra.id);
      setMotivoMatch('Matched by existing source');
      return;
    }
    const porTitulo = encontrarObraPorTitulo(obrasRaw, comixObra);
    if (porTitulo) {
      setObraSelecionadaId(porTitulo.obra.id);
      setMotivoMatch('Matched by title');
      return;
    }
    // Nada casou: fica pro seletor manual (obraSelecionadaId permanece null).
  }, [comixObra, obraIdParam, obrasRaw, fontesRaw, hidResolvido]);

  const obraAlvo = obraSelecionadaId ? (obrasRaw ?? []).find((o) => o.id === obraSelecionadaId) ?? null : null;
  const criandoNova = modoNovaObra && !obraSelecionadaId;
  const alvoResolvido = obraAlvo !== null || criandoNova;

  // --- Estado de aceite dos campos da conferência (Bloco E5) ------------------
  const [aceitarTitulo, setAceitarTitulo] = useState(false);
  const [altSelecionados, setAltSelecionados] = useState<Set<string>>(new Set());
  const [aceitarTipo, setAceitarTipo] = useState(false);
  const [aceitarStatus, setAceitarStatus] = useState(false);
  const [aceitarAutor, setAceitarAutor] = useState(false);
  const [aceitarArtistas, setAceitarArtistas] = useState(false);
  const [aceitarCapa, setAceitarCapa] = useState(false);
  const [classificacaoEscolhida, setClassificacaoEscolhida] = useState<Classificacao | null>(null);
  const [generosSelecionados, setGenerosSelecionados] = useState<Set<string>>(new Set());
  const [tagsSelecionados, setTagsSelecionados] = useState<Set<string>>(new Set());
  const [aceitarLinks, setAceitarLinks] = useState<AceitarLinks>({ al: false, mal: false, mu: false, md: false, mb: false });
  const [aceitarFonte, setAceitarFonte] = useState(false);
  const [mostrarTodosAltTitulos, setMostrarTodosAltTitulos] = useState(false);

  // Recalcula todos os defaults quando o alvo (ou o próprio comixObra) muda.
  useEffect(() => {
    if (!comixObra || !alvoResolvido) return;

    const tituloIgual = obraAlvo ? normalizarTitulo(obraAlvo.titulo) === normalizarTitulo(comixObra.titulo) : true;
    setAceitarTitulo(!criandoNova && !tituloIgual);
    setAltSelecionados(new Set());

    setAceitarTipo(comixObra.tipo != null && (criandoNova || !obraAlvo?.tipo));
    setAceitarStatus(comixObra.statusPublicacao != null && (criandoNova || !obraAlvo?.status_publicacao));
    setAceitarAutor(comixObra.autores.length > 0 && (criandoNova || !obraAlvo?.autor));
    setAceitarArtistas(comixObra.artistas.length > 0 && (criandoNova || !obraAlvo?.artistas));
    setAceitarCapa(!!comixObra.capaUrl && (criandoNova || !obraAlvo?.capa_url));
    setClassificacaoEscolhida(criandoNova ? null : (obraAlvo?.classificacao ?? null));

    const { conhecidos: generosConhecidosMatch } = classificarValoresLista(comixObra.generos, generosConhecidos);
    setGenerosSelecionados(new Set(generosConhecidosMatch.filter((g) => !(obraAlvo?.generos ?? []).includes(g))));
    const { conhecidos: tagsConhecidosMatch } = classificarValoresLista(comixObra.tags, tagsConhecidos);
    setTagsSelecionados(new Set(tagsConhecidosMatch.filter((t) => !(obraAlvo?.tags ?? []).includes(t))));

    setAceitarLinks({
      al: !!comixObra.links.anilist_url && (criandoNova || !obraAlvo?.anilist_url),
      mal: !!comixObra.links.myanimelist_url && (criandoNova || !obraAlvo?.myanimelist_url),
      mu: !!comixObra.links.mangaupdates_url && (criandoNova || !obraAlvo?.mangaupdates_url),
      md: !!comixObra.links.mangadex_url && (criandoNova || !obraAlvo?.mangadex_url),
      mb: !!comixObra.links.mangabaka_url && (criandoNova || !obraAlvo?.mangabaka_url),
    });

    const fontesDoAlvo = obraAlvo ? (fontesRaw ?? []).filter((f) => f.obra_id === obraAlvo.id) : [];
    const fonteComix = fontesDoAlvo.find((f) => urlComparavel(f.url).includes(`/title/${comixObra.hid}`));
    setAceitarFonte(criandoNova || !fonteComix || fonteComix.ultimo_capitulo_detectado !== comixObra.ultimoCapitulo);
    setMostrarTodosAltTitulos(false);
    // obraAlvo muda de identidade a cada render (novo objeto do array); usamos
    // o id como dependência estável pra não recalcular defaults a cada digitação.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comixObra, obraAlvo?.id, criandoNova]);

  const generosClassificados = comixObra ? classificarValoresLista(comixObra.generos, generosConhecidos) : { conhecidos: [], novos: [] };
  const tagsClassificados = comixObra ? classificarValoresLista(comixObra.tags, tagsConhecidos) : { conhecidos: [], novos: [] };

  const altFaltantes = useMemo(() => {
    if (!comixObra) return [];
    const existentes = new Set((obraAlvo?.titulos_alternativos ?? []).map(normalizarTitulo));
    return comixObra.titulosAlternativos.filter((t) => !existentes.has(normalizarTitulo(t)));
  }, [comixObra, obraAlvo]);
  const altJaExistentes = comixObra
    ? comixObra.titulosAlternativos.filter((t) => !altFaltantes.includes(t))
    : [];
  const altLatinos = altFaltantes.filter(ehTituloLatino);
  const altNaoLatinos = altFaltantes.filter((t) => !ehTituloLatino(t));

  function alternarAlt(titulo: string) {
    setAltSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(titulo)) novo.delete(titulo);
      else novo.add(titulo);
      return novo;
    });
  }

  function alternarValor(set: Set<string>, setter: (v: Set<string>) => void, valor: string) {
    const novo = new Set(set);
    if (novo.has(valor)) novo.delete(valor);
    else novo.add(valor);
    setter(novo);
  }

  // --- Resumo (Bloco E6) -------------------------------------------------------
  const tituloIgualAtual = obraAlvo ? normalizarTitulo(obraAlvo.titulo) === normalizarTitulo(comixObra?.titulo ?? '') : true;
  const mostrarCheckboxTitulo = !criandoNova && comixObra != null && !tituloIgualAtual;

  const classificacaoAtualAlvo = criandoNova ? null : (obraAlvo?.classificacao ?? null);
  const camposEscalaresAceitos = comixObra
    ? [
        mostrarCheckboxTitulo && aceitarTitulo,
        comixObra.tipo != null && aceitarTipo,
        comixObra.statusPublicacao != null && aceitarStatus,
        comixObra.autores.length > 0 && aceitarAutor,
        comixObra.artistas.length > 0 && aceitarArtistas,
        !!comixObra.capaUrl && aceitarCapa,
        classificacaoEscolhida !== classificacaoAtualAlvo,
        aceitarLinks.al && !!comixObra.links.anilist_url,
        aceitarLinks.mal && !!comixObra.links.myanimelist_url,
        aceitarLinks.mu && !!comixObra.links.mangaupdates_url,
        aceitarLinks.md && !!comixObra.links.mangadex_url,
        aceitarLinks.mb && !!comixObra.links.mangabaka_url,
        generosSelecionados.size > 0,
        tagsSelecionados.size > 0,
      ].filter(Boolean).length
    : 0;

  const nadaMarcado =
    camposEscalaresAceitos === 0 && altSelecionados.size === 0 && !aceitarFonte && !(criandoNova && comixObra);

  const { executar: executarConfirmar, executando: salvando } = useAsyncAction(async () => {
    if (!comixObra) return;

    const tituloFinal = criandoNova ? comixObra.titulo : aceitarTitulo ? comixObra.titulo : obraAlvo!.titulo;
    const tipoFinal =
      criandoNova || (aceitarTipo && comixObra.tipo) ? (aceitarTipo ? comixObra.tipo : null) : obraAlvo!.tipo;

    let obraId: string;
    let capaAntiga: string | null;

    if (criandoNova) {
      const novaObra: NovaObra = {
        tipo: tipoFinal,
        titulo: tituloFinal,
        titulos_alternativos: altSelecionados.size > 0 ? Array.from(altSelecionados) : null,
        autor: aceitarAutor && comixObra.autores.length > 0 ? comixObra.autores.join(', ') : null,
        artistas: aceitarArtistas && comixObra.artistas.length > 0 ? comixObra.artistas.join(', ') : null,
        capa_url: null,
        capitulo_atual: null,
        status_leitura: null,
        status_publicacao: aceitarStatus ? comixObra.statusPublicacao : null,
        // comix é fonte externa da mesma natureza do scraper — não trava a manual (E5).
        status_publicacao_manual: false,
        fim_de_temporada: false,
        ultimo_capitulo_lancado: null,
        ultimo_capitulo_via_scraper: false,
        score: null,
        generos: generosSelecionados.size > 0 ? Array.from(generosSelecionados) : null,
        tags: tagsSelecionados.size > 0 ? Array.from(tagsSelecionados) : null,
        observacoes: null,
        obra_vinculada_id: null,
        classificacao: classificacaoEscolhida,
        novelupdates_url: null,
        anilist_url: aceitarLinks.al ? comixObra.links.anilist_url : null,
        myanimelist_url: aceitarLinks.mal ? comixObra.links.myanimelist_url : null,
        mangaupdates_url: aceitarLinks.mu ? comixObra.links.mangaupdates_url : null,
        mangadex_url: aceitarLinks.md ? comixObra.links.mangadex_url : null,
        mangabaka_url: aceitarLinks.mb ? comixObra.links.mangabaka_url : null,
        pdf: false,
      };
      const { obra } = await criarObraComFontes(novaObra, []);
      obraId = obra.id;
      capaAntiga = null;
    } else {
      const obra = obraAlvo!;
      const patch: Partial<NovaObra> = {};

      if (aceitarTitulo) {
        patch.titulo = comixObra.titulo;
        patch.titulos_alternativos = [...(obra.titulos_alternativos ?? []), obra.titulo];
      }
      if (altSelecionados.size > 0) {
        const base = (patch.titulos_alternativos as string[] | undefined) ?? obra.titulos_alternativos ?? [];
        patch.titulos_alternativos = [...base, ...Array.from(altSelecionados)];
      }
      if (aceitarTipo && comixObra.tipo) patch.tipo = comixObra.tipo;
      // Status do comix nunca marca status_publicacao_manual — é fonte externa,
      // igual ao scraper; travar aqui prenderia o scraper pra sempre (E5).
      if (aceitarStatus && comixObra.statusPublicacao) patch.status_publicacao = comixObra.statusPublicacao;
      if (aceitarAutor && comixObra.autores.length > 0) patch.autor = comixObra.autores.join(', ');
      if (aceitarArtistas && comixObra.artistas.length > 0) patch.artistas = comixObra.artistas.join(', ');
      if (classificacaoEscolhida !== classificacaoAtualAlvo) patch.classificacao = classificacaoEscolhida;
      if (generosSelecionados.size > 0) {
        const existentes = new Set(obra.generos ?? []);
        patch.generos = [...(obra.generos ?? []), ...Array.from(generosSelecionados).filter((g) => !existentes.has(g))];
      }
      if (tagsSelecionados.size > 0) {
        const existentes = new Set(obra.tags ?? []);
        patch.tags = [...(obra.tags ?? []), ...Array.from(tagsSelecionados).filter((t) => !existentes.has(t))];
      }
      if (aceitarLinks.al) patch.anilist_url = comixObra.links.anilist_url;
      if (aceitarLinks.mal) patch.myanimelist_url = comixObra.links.myanimelist_url;
      if (aceitarLinks.mu) patch.mangaupdates_url = comixObra.links.mangaupdates_url;
      if (aceitarLinks.md) patch.mangadex_url = comixObra.links.mangadex_url;
      if (aceitarLinks.mb) patch.mangabaka_url = comixObra.links.mangabaka_url;

      if (Object.keys(patch).length > 0) {
        await salvarCamposObra(obra, patch, (mensagem) => mostrarToast(`Could not rename cover: ${mensagem}`, 'erro'));
      }
      obraId = obra.id;
      capaAntiga = obra.capa_url;
    }

    // 3. Capa — depois do patch/criação de propósito: salvarCamposObra já rodou
    // o rename com o slug novo, então o upload usa o slug certo (E6).
    if (aceitarCapa && comixObra.capaUrl) {
      try {
        const resp = await fetch(comixObra.capaUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const contentType = resp.headers.get('content-type') ?? 'image/jpeg';
        const ext = contentType.split('/').pop()?.split(';')[0] || 'jpg';
        const file = new File([blob], `capa.${ext}`, { type: contentType });
        const novaCapaUrl = await uploadCapa(file, tituloFinal, tipoFinal);
        await updateObra(obraId, { capa_url: novaCapaUrl });
        await deletarCapaAntigaSeDiferente(capaAntiga, novaCapaUrl);
      } catch (err) {
        mostrarToast(`Could not download comix.to cover: ${mensagemDeErro(err)}`, 'erro');
      }
    }

    // 4. Fonte
    if (aceitarFonte) {
      const fontesAtuais = criandoNova ? [] : (fontesRaw ?? []).filter((f) => f.obra_id === obraId);
      const fonteExistente = fontesAtuais.find((f) => urlComparavel(f.url).includes(`/title/${comixObra.hid}`));
      const fonte = fonteExistente ?? (await adicionarFonteNaObra(obraId, comixObra.url, tipoFinal, fontesAtuais));
      await updateFonte(fonte.id, {
        ultimo_capitulo_detectado: comixObra.ultimoCapitulo,
        atualizado_por_scraper: true,
      });
    }

    // 5. Valores novos de lista
    for (const g of generosSelecionados) {
      if (!generosConhecidos.includes(g)) await adicionarValorLista('genero', g).catch(() => {});
    }
    for (const t of tagsSelecionados) {
      if (!tagsConhecidos.includes(t)) await adicionarValorLista('tag', t).catch(() => {});
    }

    // 6.
    mostrarToast('Work imported ✓');
    navigate(`/obra/${obraId}`);
  });

  return (
    <div className="importar-page">
      <h2>Import from comix.to</h2>

      {!comixObra && (
        <>
          <p>Paste the address of a comix.to title page to import its data.</p>
          <form
            className="importar-url-form"
            onSubmit={(e) => {
              e.preventDefault();
              void executarBusca();
            }}
          >
            <input
              type="url"
              placeholder="https://comix.to/title/…"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              required
            />
            <button type="submit" disabled={buscando}>
              {buscando ? 'Fetching…' : 'Fetch'}
            </button>
          </form>
          {erroBusca && <p className="importar-erro">{erroBusca}</p>}
        </>
      )}

      {comixObra && (
        <>
          <div className="importar-alvo">
            {motivoMatch && obraSelecionadaId && <p className="importar-alvo-motivo">{motivoMatch}</p>}
            <VinculoObraSelect
              value={obraSelecionadaId ?? ''}
              onChange={(id) => {
                setObraSelecionadaId(id || null);
                setMotivoMatch(null);
                if (id) setModoNovaObra(false);
              }}
            />
            {!obraSelecionadaId && !modoNovaObra && (
              <button type="button" onClick={() => setModoNovaObra(true)}>
                Create new work
              </button>
            )}
            {modoNovaObra && !obraSelecionadaId && (
              <div className="importar-alvo-novo">
                <span>Creating a new work: "{comixObra.titulo}".</span>
                <button type="button" className="botao-secundario" onClick={() => setModoNovaObra(false)}>
                  Cancel
                </button>
              </div>
            )}
          </div>

          {alvoResolvido && (
            <>
              {/* 1. Title */}
              <section className="importar-secao">
                <h3>Title</h3>
                {criandoNova ? (
                  <p className="importar-linha">New work: "{comixObra.titulo}"</p>
                ) : mostrarCheckboxTitulo ? (
                  <label className="importar-linha">
                    <input type="checkbox" checked={aceitarTitulo} onChange={(e) => setAceitarTitulo(e.target.checked)} />
                    Use the comix.to title and keep "{obraAlvo!.titulo}" as an alternative title
                  </label>
                ) : (
                  <p className="importar-linha">Title already matches.</p>
                )}
              </section>

              {/* 2. Alternative titles */}
              <section className="importar-secao">
                <h3>Alternative titles</h3>
                {altJaExistentes.length > 0 && (
                  <ul className="importar-ja-existe-lista">
                    {altJaExistentes.map((t) => (
                      <li key={t} className="importar-ja-existe">
                        {t} (already added)
                      </li>
                    ))}
                  </ul>
                )}
                {altLatinos.length > 0 && (
                  <>
                    <button type="button" onClick={() => setAltSelecionados(new Set([...altSelecionados, ...altLatinos]))}>
                      Select all Latin
                    </button>
                    {altLatinos.map((t) => (
                      <label key={t} className="importar-linha">
                        <input type="checkbox" checked={altSelecionados.has(t)} onChange={() => alternarAlt(t)} />
                        {t}
                      </label>
                    ))}
                  </>
                )}
                {altNaoLatinos.length > 0 && (
                  <>
                    <button type="button" onClick={() => setMostrarTodosAltTitulos((v) => !v)}>
                      {mostrarTodosAltTitulos ? 'Hide non-Latin titles' : `Show ${altNaoLatinos.length} more`}
                    </button>
                    {mostrarTodosAltTitulos &&
                      altNaoLatinos.map((t) => (
                        <label key={t} className="importar-linha">
                          <input type="checkbox" checked={altSelecionados.has(t)} onChange={() => alternarAlt(t)} />
                          {t}
                        </label>
                      ))}
                  </>
                )}
              </section>

              {/* 3. Type / Publication status */}
              <section className="importar-secao">
                <h3>Type &amp; Publication status</h3>
                <label className="importar-linha">
                  <input
                    type="checkbox"
                    checked={aceitarTipo}
                    disabled={comixObra.tipo == null}
                    onChange={(e) => setAceitarTipo(e.target.checked)}
                  />
                  {comixObra.tipo ? (
                    <>
                      {!criandoNova && (
                        <span className="importar-valor-atual">
                          <strong>Current:</strong> {obraAlvo!.tipo ?? '—'}
                        </span>
                      )}
                      <span className="importar-valor-novo">comix.to: {comixObra.tipo}</span>
                    </>
                  ) : (
                    <span>Type not recognized (raw value: "{comixObra.tipoBruto ?? '?'}")</span>
                  )}
                </label>
                <label className="importar-linha">
                  <input
                    type="checkbox"
                    checked={aceitarStatus}
                    disabled={comixObra.statusPublicacao == null}
                    onChange={(e) => setAceitarStatus(e.target.checked)}
                  />
                  {comixObra.statusPublicacao ? (
                    <>
                      {!criandoNova && (
                        <span className="importar-valor-atual">
                          <strong>Current:</strong> {obraAlvo!.status_publicacao ?? '—'}
                        </span>
                      )}
                      <span className="importar-valor-novo">comix.to: {comixObra.statusPublicacao}</span>
                    </>
                  ) : (
                    <span>Publication status not recognized (raw value: "{comixObra.statusPublicacaoBruto ?? '?'}")</span>
                  )}
                </label>
              </section>

              {/* 4. Author / Artists */}
              <section className="importar-secao">
                <h3>Author &amp; Artists</h3>
                {comixObra.autores.length > 0 && (
                  <label className="importar-linha">
                    <input type="checkbox" checked={aceitarAutor} onChange={(e) => setAceitarAutor(e.target.checked)} />
                    {!criandoNova && obraAlvo!.autor && (
                      <span className="importar-valor-atual">
                        <strong>Current:</strong> {obraAlvo!.autor}
                      </span>
                    )}
                    <span className="importar-valor-novo">comix.to: {comixObra.autores.join(', ')}</span>
                  </label>
                )}
                {comixObra.artistas.length > 0 && (
                  <label className="importar-linha">
                    <input type="checkbox" checked={aceitarArtistas} onChange={(e) => setAceitarArtistas(e.target.checked)} />
                    {!criandoNova && obraAlvo!.artistas && (
                      <span className="importar-valor-atual">
                        <strong>Current:</strong> {obraAlvo!.artistas}
                      </span>
                    )}
                    <span className="importar-valor-novo">comix.to: {comixObra.artistas.join(', ')}</span>
                  </label>
                )}
              </section>

              {/* 5. Cover */}
              {comixObra.capaUrl && (
                <section className="importar-secao">
                  <h3>Cover</h3>
                  <label className="importar-linha">
                    <input type="checkbox" checked={aceitarCapa} onChange={(e) => setAceitarCapa(e.target.checked)} />
                    <div className="importar-capas">
                      {!criandoNova && obraAlvo!.capa_url && <img src={obraAlvo!.capa_url} alt="Current cover" />}
                      <img src={comixObra.capaUrl} alt="comix.to cover" />
                    </div>
                  </label>
                </section>
              )}

              {/* 6. Content rating */}
              <section className="importar-secao">
                <h3>Content rating</h3>
                <p className="importar-linha">comix.to rating: {comixObra.contentRating ?? '—'}</p>
                <div className="classificacao-caixas">
                  {(['R-15', 'R-18'] as Classificacao[]).map((c) => (
                    <label key={c} className="check-inline">
                      <input
                        type="checkbox"
                        checked={classificacaoEscolhida === c}
                        onChange={(e) => setClassificacaoEscolhida(e.target.checked ? c : null)}
                      />
                      {c}
                    </label>
                  ))}
                </div>
              </section>

              {/* 7. Genres / Tags */}
              <section className="importar-secao">
                <h3>Genres</h3>
                {generosClassificados.conhecidos.length > 0 && (
                  <>
                    <p>Already in your lists</p>
                    {generosClassificados.conhecidos.map((g) => (
                      <label key={g} className="importar-linha">
                        <input
                          type="checkbox"
                          checked={generosSelecionados.has(g)}
                          onChange={() => alternarValor(generosSelecionados, setGenerosSelecionados, g)}
                        />
                        {g}
                      </label>
                    ))}
                  </>
                )}
                {generosClassificados.novos.length > 0 && (
                  <>
                    <p>New values (creates the value in your app's vocabulary)</p>
                    {generosClassificados.novos.map((g) => (
                      <label key={g} className="importar-linha">
                        <input
                          type="checkbox"
                          checked={generosSelecionados.has(g)}
                          onChange={() => alternarValor(generosSelecionados, setGenerosSelecionados, g)}
                        />
                        {g}
                      </label>
                    ))}
                  </>
                )}
              </section>

              <section className="importar-secao">
                <h3>Tags</h3>
                {tagsClassificados.conhecidos.length > 0 && (
                  <>
                    <p>Already in your lists</p>
                    {tagsClassificados.conhecidos.map((t) => (
                      <label key={t} className="importar-linha">
                        <input
                          type="checkbox"
                          checked={tagsSelecionados.has(t)}
                          onChange={() => alternarValor(tagsSelecionados, setTagsSelecionados, t)}
                        />
                        {t}
                      </label>
                    ))}
                  </>
                )}
                {tagsClassificados.novos.length > 0 && (
                  <>
                    <p>New values (creates the value in your app's vocabulary)</p>
                    {tagsClassificados.novos.map((t) => (
                      <label key={t} className="importar-linha">
                        <input
                          type="checkbox"
                          checked={tagsSelecionados.has(t)}
                          onChange={() => alternarValor(tagsSelecionados, setTagsSelecionados, t)}
                        />
                        {t}
                      </label>
                    ))}
                  </>
                )}
              </section>

              {/* 8. External links */}
              <section className="importar-secao">
                <h3>External links</h3>
                {LINKS_INFO.filter((info) => comixObra.links[info.campo]).map((info) => (
                  <label key={info.chave} className="importar-linha">
                    <input
                      type="checkbox"
                      checked={aceitarLinks[info.chave]}
                      onChange={(e) => setAceitarLinks((atual) => ({ ...atual, [info.chave]: e.target.checked }))}
                    />
                    {info.rotulo}: <span className="importar-valor-novo">{comixObra.links[info.campo]}</span>
                  </label>
                ))}
              </section>

              {/* 9. Source */}
              <section className="importar-secao">
                <h3>Source</h3>
                <label className="importar-linha">
                  <input type="checkbox" checked={aceitarFonte} onChange={(e) => setAceitarFonte(e.target.checked)} />
                  {(() => {
                    const fontesDoAlvo = obraAlvo ? (fontesRaw ?? []).filter((f) => f.obra_id === obraAlvo.id) : [];
                    const jaTem = fontesDoAlvo.some((f) => urlComparavel(f.url).includes(`/title/${comixObra.hid}`));
                    return jaTem
                      ? `Update the existing comix.to source to chapter ${comixObra.ultimoCapitulo ?? '—'}`
                      : `Add comix.to as a source (chapter ${comixObra.ultimoCapitulo ?? '—'})`;
                  })()}
                </label>
              </section>

              <div className="importar-resumo">
                {camposEscalaresAceitos} field(s) will change, {altSelecionados.size} alternative title(s) added,{' '}
                {aceitarFonte ? 1 : 0} source(s) added
              </div>

              <button type="button" disabled={nadaMarcado || salvando} onClick={() => void executarConfirmar()}>
                {salvando ? 'Saving…' : 'Confirm'}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
