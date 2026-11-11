import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/localDb';
import { createObra, criarObraVinculada, updateObra, type NovaObra } from '../db/repo';
import { uploadCapa } from '../lib/uploadCapa';
import { deletarCapaAntigaSeDiferente } from '../lib/capaStorage';
import { adicionarValorLista } from '../lib/listas';
import { normalizarTitulo } from '../lib/duplicatas';
import { ehRomano } from '../lib/novelupdates';
import {
  decodificarNovel,
  acharAlvoInicial,
  planoDoAlvo,
  type NovelImportada,
  type PlanoImport,
} from '../lib/novelupdatesImport';
import { mensagemDeErro } from '../lib/erros';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useListasPorCategoria } from '../hooks/useListas';
import { useToast } from '../components/Toast';
import { VinculoObraSelect } from '../components/VinculoObraSelect';
import type { Obra } from '../types';

/** Separa valores do NU em "já conhecidos" (casam com `listas`, grafia canônica) e "novos". */
function classificarValoresLista(valores: string[], conhecidos: string[]): { conhecidos: string[]; novos: string[] } {
  const porNormalizado = new Map(conhecidos.map((c) => [normalizarTitulo(c), c]));
  const resultado = { conhecidos: [] as string[], novos: [] as string[] };
  const vistos = new Set<string>();
  for (const valor of valores) {
    const norm = normalizarTitulo(valor);
    if (!norm || vistos.has(norm)) continue;
    vistos.add(norm);
    const match = porNormalizado.get(norm);
    if (match) resultado.conhecidos.push(match);
    else resultado.novos.push(valor);
  }
  return resultado;
}

/** União sem duplicar (case-insensitive por normalizarTitulo), preservando a ordem. */
function unir(existentes: string[] | null | undefined, novos: string[]): string[] {
  const resultado = [...(existentes ?? [])];
  const ja = new Set(resultado.map(normalizarTitulo));
  for (const v of novos) {
    const n = normalizarTitulo(v);
    if (n && !ja.has(n)) {
      ja.add(n);
      resultado.push(v);
    }
  }
  return resultado;
}

/** Texto que explica, em inglês (UI), o que a confirmação vai fazer com o alvo atual. */
function descreverPlano(plano: PlanoImport): string {
  switch (plano.tipo) {
    case 'criarNova':
      return 'No matching work found. A new Novel will be created.';
    case 'atualizar':
      return `Will update “${plano.obra.titulo}”${plano.obra.tipo ? ` (${plano.obra.tipo})` : ''} and set its Novel Updates link.`;
    case 'criarVinculada':
      return `“${plano.manga.titulo}”${plano.manga.tipo ? ` (${plano.manga.tipo})` : ''} found. A new Novel will be created and linked to it as its corresponding work.`;
  }
}

export function ImportarNovelUpdatesPage() {
  const navigate = useNavigate();
  const { mostrarToast } = useToast();

  const obrasRaw = useLiveQuery(() => db.obras.toArray(), []);
  const generosConhecidos = useListasPorCategoria('genero');
  const tagsConhecidos = useListasPorCategoria('tag');

  const [novel, setNovel] = useState<NovelImportada | null>(null);

  // Fragmento #d=... (bookmarklet): lido uma vez, depois limpo da barra de endereços.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith('#d=')) return;
    try {
      setNovel(decodificarNovel(hash.slice(3)));
    } catch (err) {
      mostrarToast(mensagemDeErro(err), 'erro');
    }
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Alvo / vínculo ---------------------------------------------------------
  const [alvoId, setAlvoId] = useState('');
  const [slugResolvido, setSlugResolvido] = useState<string | null>(null);
  const [motivoAuto, setMotivoAuto] = useState<string | null>(null);

  useEffect(() => {
    if (!novel || !obrasRaw) return;
    if (slugResolvido === novel.slug) return;
    setSlugResolvido(novel.slug);
    const inicial = acharAlvoInicial(obrasRaw, novel);
    setAlvoId(inicial);
    setMotivoAuto(inicial ? 'Auto-matched by title' : null);
  }, [novel, obrasRaw, slugResolvido]);

  const plano = useMemo<PlanoImport>(
    () => (novel && obrasRaw ? planoDoAlvo(obrasRaw, alvoId) : { tipo: 'criarNova' }),
    [novel, obrasRaw, alvoId]
  );
  // Obra base para comparar campos (títulos já presentes, gêneros/tags): a Novel
  // que será atualizada, ou o mangá cuja contraparte será criada.
  const baseObra: Obra | null = plano.tipo === 'atualizar' ? plano.obra : plano.tipo === 'criarVinculada' ? plano.manga : null;
  const alvoNovelExistente = plano.tipo === 'atualizar' ? plano.obra : null;

  // --- Aceite dos campos ------------------------------------------------------
  const [altSelecionados, setAltSelecionados] = useState<Set<string>>(new Set());
  const [aceitarAutor, setAceitarAutor] = useState(false);
  const [aceitarArtistas, setAceitarArtistas] = useState(false);
  const [aceitarStatus, setAceitarStatus] = useState(false);
  const [aceitarCapa, setAceitarCapa] = useState(false);
  const [generosSelecionados, setGenerosSelecionados] = useState<Set<string>>(new Set());
  const [tagsSelecionados, setTagsSelecionados] = useState<Set<string>>(new Set());
  const [mostrarTodosAltTitulos, setMostrarTodosAltTitulos] = useState(false);
  const [novosValoresAbertos, setNovosValoresAbertos] = useState(false);

  // Capa manual (fallback quando a leitura automática dos bytes falha por CORS).
  const [capaManual, setCapaManual] = useState<File | null>(null);
  const [capaAutoFalhou, setCapaAutoFalhou] = useState(false);
  const [capaManualPreviewUrl, setCapaManualPreviewUrl] = useState<string | null>(null);
  const capaManualInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!capaManual) {
      setCapaManualPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(capaManual);
    setCapaManualPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [capaManual]);

  function selecionarCapaManual(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (file) setCapaManual(file);
  }

  const alvoKey = `${plano.tipo}:${baseObra?.id ?? ''}`;
  useEffect(() => {
    if (!novel) return;
    setAltSelecionados(new Set());
    setAceitarAutor(novel.autores.length > 0 && (!alvoNovelExistente || !alvoNovelExistente.autor));
    setAceitarArtistas(novel.artistas.length > 0 && (!alvoNovelExistente || !alvoNovelExistente.artistas));
    setAceitarStatus(novel.statusPublicacao != null && (!alvoNovelExistente || !alvoNovelExistente.status_publicacao));
    setAceitarCapa(!!(novel.capaBase64 || novel.capaUrl) && (!alvoNovelExistente || !alvoNovelExistente.capa_url));
    setCapaManual(null);
    setCapaAutoFalhou(false);

    const { conhecidos: gConhecidos } = classificarValoresLista(novel.generos, generosConhecidos);
    setGenerosSelecionados(new Set(gConhecidos.filter((g) => !(baseObra?.generos ?? []).includes(g))));
    const { conhecidos: tConhecidos } = classificarValoresLista(novel.tags, tagsConhecidos);
    setTagsSelecionados(new Set(tConhecidos.filter((t) => !(baseObra?.tags ?? []).includes(t))));

    setMostrarTodosAltTitulos(false);
    setNovosValoresAbertos(false);
    // baseObra muda de identidade a cada render; alvoKey é a dependência estável.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novel, alvoKey]);

  const generosClassificados = novel ? classificarValoresLista(novel.generos, generosConhecidos) : { conhecidos: [], novos: [] };
  const tagsClassificados = novel ? classificarValoresLista(novel.tags, tagsConhecidos) : { conhecidos: [], novos: [] };

  const altFaltantes = useMemo(() => {
    if (!novel) return [];
    const existentes = new Set((baseObra?.titulos_alternativos ?? []).map(normalizarTitulo));
    // O título principal da obra base também não precisa virar título alternativo.
    if (baseObra) existentes.add(normalizarTitulo(baseObra.titulo));
    return novel.titulosAlternativos.filter((t) => !existentes.has(normalizarTitulo(t)));
  }, [novel, baseObra]);
  const altJaExistentes = novel ? novel.titulosAlternativos.filter((t) => !altFaltantes.includes(t)) : [];
  const altLatinos = altFaltantes.filter(ehRomano);
  const altNaoLatinos = altFaltantes.filter((t) => !ehRomano(t));

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

  const { executar: executarConfirmar, executando: salvando } = useAsyncAction(async () => {
    if (!novel || !obrasRaw) return;
    const planoAtual = planoDoAlvo(obrasRaw, alvoId);

    const autor = aceitarAutor && novel.autores.length > 0 ? novel.autores.join(', ') : null;
    const artistas = aceitarArtistas && novel.artistas.length > 0 ? novel.artistas.join(', ') : null;
    const status = aceitarStatus ? novel.statusPublicacao : null;
    const altArray = Array.from(altSelecionados);
    const generosArray = Array.from(generosSelecionados);
    const tagsArray = Array.from(tagsSelecionados);

    let obraId: string;
    let capaAntiga: string | null = null;
    let tituloParaCapa: string;

    if (planoAtual.tipo === 'criarNova') {
      const nova: NovaObra = {
        tipo: 'Novel',
        titulo: novel.titulo,
        titulos_alternativos: altArray.length > 0 ? altArray : null,
        autor,
        artistas,
        capa_url: null,
        capitulo_atual: null,
        status_leitura: null,
        status_publicacao: status,
        status_publicacao_manual: false,
        fim_de_temporada: false,
        ultimo_capitulo_lancado: null,
        ultimo_capitulo_via_scraper: false,
        score: null,
        generos: generosArray.length > 0 ? generosArray : null,
        tags: tagsArray.length > 0 ? tagsArray : null,
        observacoes: null,
        obra_vinculada_id: null,
        classificacao: null,
        novelupdates_url: novel.url,
        anilist_url: null,
        myanimelist_url: null,
        mangaupdates_url: null,
        mangadex_url: null,
        mangabaka_url: null,
        pdf: false,
        favorito: false,
        nostalgic: false,
      };
      const obra = await createObra(nova);
      obraId = obra.id;
      tituloParaCapa = novel.titulo;
    } else if (planoAtual.tipo === 'atualizar') {
      const obra = planoAtual.obra;
      const patch: Partial<NovaObra> = { novelupdates_url: novel.url };
      if (altArray.length > 0) patch.titulos_alternativos = unir(obra.titulos_alternativos, altArray);
      if (autor) patch.autor = autor;
      if (artistas) patch.artistas = artistas;
      if (status) patch.status_publicacao = status;
      if (generosArray.length > 0) patch.generos = unir(obra.generos, generosArray);
      if (tagsArray.length > 0) patch.tags = unir(obra.tags, tagsArray);
      await updateObra(obra.id, patch);
      obraId = obra.id;
      capaAntiga = obra.capa_url;
      tituloParaCapa = obra.titulo;
    } else {
      // criarVinculada: cria a Novel como contraparte do mangá e liga as duas.
      const manga = planoAtual.manga;
      const nova: NovaObra = {
        tipo: 'Novel',
        titulo: manga.titulo,
        titulos_alternativos: manga.titulos_alternativos,
        autor,
        artistas,
        capa_url: null,
        capitulo_atual: null,
        status_leitura: null,
        status_publicacao: status,
        status_publicacao_manual: false,
        fim_de_temporada: false,
        ultimo_capitulo_lancado: null,
        ultimo_capitulo_via_scraper: false,
        score: null,
        generos: manga.generos,
        tags: manga.tags,
        observacoes: null,
        obra_vinculada_id: null,
        classificacao: manga.classificacao,
        // Gravado depois via updateObra pra espelhar o link no mangá (CAMPOS_ESPELHADOS).
        novelupdates_url: null,
        anilist_url: manga.anilist_url,
        myanimelist_url: manga.myanimelist_url,
        mangaupdates_url: manga.mangaupdates_url,
        mangadex_url: manga.mangadex_url,
        mangabaka_url: manga.mangabaka_url,
        pdf: false,
        favorito: false,
        nostalgic: false,
      };
      const novaNovel = await criarObraVinculada(manga.id, nova);
      const patch: Partial<NovaObra> = { novelupdates_url: novel.url };
      // Campos espelhados em união (não apaga o que o mangá já tinha).
      if (altArray.length > 0) patch.titulos_alternativos = unir(manga.titulos_alternativos, altArray);
      if (generosArray.length > 0) patch.generos = unir(manga.generos, generosArray);
      if (tagsArray.length > 0) patch.tags = unir(manga.tags, tagsArray);
      await updateObra(novaNovel.id, patch);
      obraId = novaNovel.id;
      tituloParaCapa = manga.titulo;
    }

    // Capa (sempre na Novel criada/atualizada; capa_url não é espelhada).
    if (aceitarCapa && (capaManual || novel.capaBase64 || novel.capaUrl)) {
      try {
        let file: File;
        if (capaManual) {
          file = capaManual;
        } else {
          const resp = novel.capaBase64 ? await fetch(novel.capaBase64) : await fetch(novel.capaUrl!);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const blob = await resp.blob();
          const contentType = resp.headers.get('content-type') ?? blob.type ?? 'image/jpeg';
          const ext = contentType.split('/').pop()?.split(';')[0] || 'jpg';
          file = new File([blob], `capa.${ext}`, { type: contentType });
        }
        const novaCapaUrl = await uploadCapa(file, tituloParaCapa, 'Novel');
        await updateObra(obraId, { capa_url: novaCapaUrl });
        await deletarCapaAntigaSeDiferente(capaAntiga, novaCapaUrl);
      } catch (err) {
        const contexto = capaManual ? 'Could not upload cover' : 'Could not download Novel Updates cover';
        mostrarToast(`${contexto}: ${mensagemDeErro(err)}`, 'erro');
      }
    }

    // Valores novos de gênero/tag entram no vocabulário.
    for (const g of generosArray) {
      if (!generosConhecidos.includes(g)) await adicionarValorLista('genero', g).catch(() => {});
    }
    for (const t of tagsArray) {
      if (!tagsConhecidos.includes(t)) await adicionarValorLista('tag', t).catch(() => {});
    }

    mostrarToast('Novel imported ✓');
    navigate(`/obra/${obraId}`);
  });

  return (
    <div className="importar-page">
      <h2>Import from Novel Updates</h2>

      {!novel && (
        <p>
          Open a Novel Updates series page and use the “Import Novel Updates” bookmarklet to send it here (see
          docs/EXTENSAO_NOVELUPDATES.md).
        </p>
      )}

      {novel && (
        <>
          {/* Alvo / vínculo (regras 2 e 3) */}
          <section className="importar-secao">
            <h3>Target</h3>
            <p className="importar-linha">
              From Novel Updates: <strong>{novel.titulo}</strong>
            </p>
            {motivoAuto && alvoId && <p className="importar-alvo-motivo">{motivoAuto}</p>}
            <p className="importar-linha">{descreverPlano(plano)}</p>
            <div className="vinculo-obra-caixa-linha">
              <VinculoObraSelect
                value={alvoId}
                onChange={(id) => {
                  setAlvoId(id);
                  setMotivoAuto(null);
                }}
                placeholder="Link to an existing work…"
              />
            </div>
            <p className="importar-ja-existe">
              Pick an existing manga/novel to link, or clear the selection to create a standalone Novel. You can also
              change or remove the link later on the work’s page.
            </p>
          </section>

          {/* Alternative titles */}
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
            {altFaltantes.length === 0 && altJaExistentes.length === 0 && (
              <p className="importar-ja-existe">No alternative titles.</p>
            )}
          </section>

          {/* Author / Artists */}
          {(novel.autores.length > 0 || novel.artistas.length > 0) && (
            <section className="importar-secao">
              <h3>Author &amp; Artists</h3>
              {novel.autores.length > 0 && (
                <label className="importar-linha">
                  <input type="checkbox" checked={aceitarAutor} onChange={(e) => setAceitarAutor(e.target.checked)} />
                  {alvoNovelExistente?.autor && (
                    <span className="importar-valor-atual">
                      <strong>Current:</strong> {alvoNovelExistente.autor}
                    </span>
                  )}
                  <span className="importar-valor-novo">{novel.autores.join(', ')}</span>
                </label>
              )}
              {novel.artistas.length > 0 && (
                <label className="importar-linha">
                  <input type="checkbox" checked={aceitarArtistas} onChange={(e) => setAceitarArtistas(e.target.checked)} />
                  {alvoNovelExistente?.artistas && (
                    <span className="importar-valor-atual">
                      <strong>Current:</strong> {alvoNovelExistente.artistas}
                    </span>
                  )}
                  <span className="importar-valor-novo">{novel.artistas.join(', ')}</span>
                </label>
              )}
            </section>
          )}

          {/* Publication status */}
          <section className="importar-secao">
            <h3>Publication status</h3>
            <label className="importar-linha">
              <input
                type="checkbox"
                checked={aceitarStatus}
                disabled={novel.statusPublicacao == null}
                onChange={(e) => setAceitarStatus(e.target.checked)}
              />
              {novel.statusPublicacao ? (
                <>
                  {alvoNovelExistente?.status_publicacao && (
                    <span className="importar-valor-atual">
                      <strong>Current:</strong> {alvoNovelExistente.status_publicacao}
                    </span>
                  )}
                  <span className="importar-valor-novo">{novel.statusPublicacao}</span>
                </>
              ) : (
                <span>Status not recognized (raw value: "{novel.statusPublicacaoBruto ?? '?'}")</span>
              )}
            </label>
          </section>

          {/* Cover */}
          {(novel.capaBase64 || novel.capaUrl) && (
            <section className="importar-secao">
              <h3>Cover</h3>
              <label className="importar-linha">
                <input type="checkbox" checked={aceitarCapa} onChange={(e) => setAceitarCapa(e.target.checked)} />
                <div className="importar-capas">
                  {alvoNovelExistente?.capa_url && <img src={alvoNovelExistente.capa_url} alt="Current cover" />}
                  {capaManualPreviewUrl ? (
                    <img
                      src={capaManualPreviewUrl}
                      alt="Manually selected cover"
                      className="capa-preview"
                      onClick={(e) => {
                        e.preventDefault();
                        capaManualInputRef.current?.click();
                      }}
                    />
                  ) : capaAutoFalhou ? (
                    <div
                      className="capa-preview-vazia"
                      role="button"
                      aria-label="Choose cover file"
                      onClick={(e) => {
                        e.preventDefault();
                        capaManualInputRef.current?.click();
                      }}
                    >
                      +
                    </div>
                  ) : (
                    <img
                      src={novel.capaBase64 ?? novel.capaUrl ?? undefined}
                      alt="Novel Updates cover"
                      onError={() => setCapaAutoFalhou(true)}
                    />
                  )}
                </div>
              </label>
              {capaAutoFalhou && (
                <a
                  href={novel.url}
                  target="_blank"
                  rel="noreferrer"
                  className="importar-capa-comix-link"
                  title="Open on Novel Updates to save the cover image"
                >
                  <span>Open on Novel Updates</span>
                </a>
              )}
              <input ref={capaManualInputRef} type="file" accept="image/*" hidden onChange={selecionarCapaManual} />
            </section>
          )}

          {/* Genres */}
          <section className="importar-secao">
            <div className="importar-secao-titulo">
              <h3>Genres</h3>
              {generosClassificados.conhecidos.length > 0 && (
                <button
                  type="button"
                  onClick={() => setGenerosSelecionados(new Set([...generosSelecionados, ...generosClassificados.conhecidos]))}
                >
                  Select all
                </button>
              )}
            </div>
            {generosClassificados.conhecidos.length > 0 ? (
              <div className="importar-grid">
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
              </div>
            ) : (
              <p className="importar-ja-existe">No matching genres.</p>
            )}
          </section>

          {/* Tags */}
          <section className="importar-secao">
            <div className="importar-secao-titulo">
              <h3>Tags</h3>
              {tagsClassificados.conhecidos.length > 0 && (
                <button
                  type="button"
                  onClick={() => setTagsSelecionados(new Set([...tagsSelecionados, ...tagsClassificados.conhecidos]))}
                >
                  Select all
                </button>
              )}
            </div>
            {tagsClassificados.conhecidos.length > 0 ? (
              <div className="importar-grid">
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
              </div>
            ) : (
              <p className="importar-ja-existe">No matching tags.</p>
            )}
          </section>

          {/* New values (genres/tags fora do vocabulário) */}
          {(generosClassificados.novos.length > 0 || tagsClassificados.novos.length > 0) && (
            <section className="importar-secao">
              <button
                type="button"
                className="importar-secao-toggle"
                onClick={() => setNovosValoresAbertos((v) => !v)}
                aria-expanded={novosValoresAbertos}
              >
                {novosValoresAbertos ? '▾' : '▸'} New Values
              </button>
              {novosValoresAbertos && (
                <div className="importar-secao-corpo">
                  {generosClassificados.novos.length > 0 && (
                    <div className="importar-subsecao">
                      <h4>Genres</h4>
                      <div className="importar-grid">
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
                      </div>
                    </div>
                  )}
                  {tagsClassificados.novos.length > 0 && (
                    <div className="importar-subsecao">
                      <h4>Tags</h4>
                      <div className="importar-grid">
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
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          <div className="importar-resumo">{descreverPlano(plano)}</div>

          <button type="button" disabled={salvando} onClick={() => void executarConfirmar()}>
            {salvando ? 'Saving…' : 'Confirm'}
          </button>
        </>
      )}
    </div>
  );
}
