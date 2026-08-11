import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/localDb';
import { montarPlanoConciliacao, parseCsvConciliacao, type PlanoConciliacao } from '../lib/conciliacaoCsv';
import {
  aplicarPlanoConciliacao,
  aprovarPendenteConciliacao,
  carregarBlacklistConciliacaoComoSet,
  carregarCandidatosConciliacao,
  listarPendentesConciliacao,
  rejeitarPendenteConciliacao,
  type PendenteConciliacaoComObra,
  type ResultadoAplicacaoConciliacao,
} from '../lib/conciliacaoRepo';
import { getMatchConfig, listarBlacklistConciliacao, removerBlacklistConciliacao } from '../lib/scraperConfig';
import { mensagemDeErro } from '../lib/erros';
import type { ConciliacaoBlacklistItem } from '../lib/scraperConfig';
import type { Tipo } from '../types';

const TIPOS_OPCOES: Tipo[] = ['Manga', 'Manhwa', 'Manhua', 'Novel'];

/**
 * Seção "Related sites reconciliation" (Modo 3 da importação CSV): casa
 * título+link de uma planilha externa (sources genéricas ou links de catálogo
 * como NovelUpdates/AniList/MyAnimeList/MangaUpdates/MangaDex/MangaBaka)
 * contra o título/títulos alternativos das obras já cadastradas.
 */
export function ConciliacaoSitesSection() {
  const [tiposSelecionados, setTiposSelecionados] = useState<Set<Tipo>>(new Set(['Manga', 'Manhwa', 'Manhua']));
  const [analisando, setAnalisando] = useState(false);
  const [plano, setPlano] = useState<PlanoConciliacao | null>(null);
  const [comCabecalho, setComCabecalho] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoAplicacaoConciliacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  function alternarTipo(tipo: Tipo) {
    setTiposSelecionados((prev) => {
      const s = new Set(prev);
      if (s.has(tipo)) s.delete(tipo);
      else s.add(tipo);
      return s;
    });
    setPlano(null);
    setResultado(null);
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || tiposSelecionados.size === 0) return;

    setAnalisando(true);
    setErro(null);
    setPlano(null);
    setResultado(null);
    try {
      const texto = await file.text();
      const { linhas, comCabecalho: detectouCabecalho } = parseCsvConciliacao(texto);
      setComCabecalho(detectouCabecalho);
      const [candidatos, blacklist, matchConfig] = await Promise.all([
        carregarCandidatosConciliacao(tiposSelecionados),
        carregarBlacklistConciliacaoComoSet(),
        getMatchConfig(),
      ]);
      setPlano(montarPlanoConciliacao(linhas, candidatos, blacklist, matchConfig.conciliacao_csv));
    } catch (err) {
      setErro(mensagemDeErro(err));
    } finally {
      setAnalisando(false);
    }
  }

  async function handleAplicar() {
    if (!plano) return;
    setAplicando(true);
    setErro(null);
    try {
      const res = await aplicarPlanoConciliacao(plano);
      setResultado(res);
      setPlano(null);
      await recarregarFila();
    } catch (err) {
      setErro(mensagemDeErro(err));
    } finally {
      setAplicando(false);
    }
  }

  // --- Fila de aprovação (70-89% e empates) ---------------------------------

  const [pendentes, setPendentes] = useState<PendenteConciliacaoComObra[]>([]);
  const [carregandoFila, setCarregandoFila] = useState(true);
  const [filaAberta, setFilaAberta] = useState(false);
  const [erroFila, setErroFila] = useState<string | null>(null);
  const [processandoItem, setProcessandoItem] = useState<string | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [progressoLote, setProgressoLote] = useState<{ rotulo: string; feito: number; total: number } | null>(null);
  const [busca, setBusca] = useState('');

  const recarregarFila = useCallback(async () => {
    setCarregandoFila(true);
    setErroFila(null);
    try {
      setPendentes(await listarPendentesConciliacao());
    } catch (err) {
      setErroFila(mensagemDeErro(err));
    } finally {
      setCarregandoFila(false);
    }
  }, []);

  useEffect(() => {
    void recarregarFila();
  }, [recarregarFila]);

  const pendentesFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return pendentes;
    return pendentes.filter(
      (p) =>
        p.obra?.titulo.toLowerCase().includes(termo) ||
        p.titulo_candidato.toLowerCase().includes(termo) ||
        p.url_candidato.toLowerCase().includes(termo)
    );
  }, [pendentes, busca]);

  async function handleAprovar(p: PendenteConciliacaoComObra) {
    setProcessandoItem(p.id);
    setErroFila(null);
    try {
      await aprovarPendenteConciliacao(p);
      await recarregarFila();
    } catch (err) {
      setErroFila(mensagemDeErro(err));
    } finally {
      setProcessandoItem(null);
    }
  }

  async function handleRejeitar(p: PendenteConciliacaoComObra) {
    setProcessandoItem(p.id);
    setErroFila(null);
    try {
      await rejeitarPendenteConciliacao(p);
      await recarregarFila();
    } catch (err) {
      setErroFila(mensagemDeErro(err));
    } finally {
      setProcessandoItem(null);
    }
  }

  function alternarSelecao(id: string) {
    setSelecionadas((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }

  function alternarTodas() {
    const ids = pendentesFiltrados.map((p) => p.id);
    setSelecionadas((prev) => {
      const todasSelecionadas = ids.length > 0 && ids.every((id) => prev.has(id));
      return new Set(todasSelecionadas ? [] : ids);
    });
  }

  const loteEmAndamento = progressoLote !== null;

  async function executarLote(acao: 'aprovar' | 'rejeitar') {
    const alvos = pendentesFiltrados.filter((p) => selecionadas.has(p.id));
    const rotulo = acao === 'aprovar' ? 'Approving' : 'Rejecting';
    setErroFila(null);
    const falhas: string[] = [];
    for (let i = 0; i < alvos.length; i++) {
      setProgressoLote({ rotulo, feito: i + 1, total: alvos.length });
      try {
        await (acao === 'aprovar' ? aprovarPendenteConciliacao(alvos[i]) : rejeitarPendenteConciliacao(alvos[i]));
      } catch (err) {
        falhas.push(mensagemDeErro(err));
      }
    }
    setProgressoLote(null);
    setSelecionadas(new Set());
    await recarregarFila();
    if (falhas.length > 0) setErroFila(`${falhas.length} failed: ${falhas.join(' · ')}`);
  }

  // --- Blacklist (pares obra/link rejeitados) --------------------------------

  const [blacklist, setBlacklist] = useState<ConciliacaoBlacklistItem[]>([]);
  const [blacklistAberta, setBlacklistAberta] = useState(false);
  const obras = useLiveQuery(() => db.obras.toArray(), []);
  const obraPorId = useMemo(() => new Map((obras ?? []).map((o) => [o.id, o.titulo])), [obras]);

  const carregarBlacklist = useCallback(() => {
    listarBlacklistConciliacao()
      .then(setBlacklist)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (blacklistAberta) carregarBlacklist();
  }, [blacklistAberta, carregarBlacklist]);

  async function handleRemoverBlacklist(id: string) {
    await removerBlacklistConciliacao(id);
    carregarBlacklist();
  }

  return (
    <section className="atualizacao-secao">
      <h3>Related sites reconciliation</h3>
      <p>
        Upload a spreadsheet with just <strong>title</strong> and <strong>link</strong> (any extra columns are
        ignored) — a dump from a reading site's catalog, or from a catalog like NovelUpdates, AniList,
        MyAnimeList, MangaUpdates, MangaDex or MangaBaka. Matches your works by title/alternative titles: exact and
        90%+ matches are linked automatically (90-99% also adds the found title as an alternative title); 70-89%
        wait for your approval below; anything lower is discarded.
      </p>

      <div className="conciliacao-tipos">
        {TIPOS_OPCOES.map((tipo) => (
          <label key={tipo} className="conciliacao-tipo-opcao">
            <input type="checkbox" checked={tiposSelecionados.has(tipo)} onChange={() => alternarTipo(tipo)} />
            {tipo}
          </label>
        ))}
      </div>
      <p className="atualizacao-subtitulo-nota">
        Only works of the type(s) checked above are compared — works of any other type are skipped entirely (e.g.
        uncheck everything but Novel for a NovelUpdates dump).
      </p>

      <div className="csv-acoes">
        <label className="upload-csv">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={handleFile}
            disabled={analisando || tiposSelecionados.size === 0}
          />
          {analisando ? 'Analyzing…' : 'Choose CSV file'}
        </label>
      </div>
      {tiposSelecionados.size === 0 && (
        <p className="execucao-status execucao-erro">Check at least one type before uploading.</p>
      )}
      {erro && <p className="execucao-status execucao-erro">{erro}</p>}

      {plano && (
        <div className="atualizacao-massa-resultado">
          {comCabecalho && <p>First row detected as a header and skipped.</p>}
          <p>
            {plano.autoAprovados.length} match(es) will be linked automatically (
            {plano.autoAprovados.filter((a) => a.exato).length} exact,{' '}
            {plano.autoAprovados.filter((a) => !a.exato).length} with alternative title added).
          </p>
          <p>{plano.pendentesNovos.length} candidate(s) will be sent to the approval queue below.</p>
          {plano.puladosBlacklist > 0 && <p>{plano.puladosBlacklist} skipped (already blacklisted).</p>}
          <p>{plano.descartados} row(s) discarded (below the review threshold).</p>
          <div className="scraper-controles">
            <button type="button" onClick={handleAplicar} disabled={aplicando}>
              {aplicando ? 'Applying…' : 'Apply'}
            </button>
            <button type="button" className="botao-secundario" onClick={() => setPlano(null)} disabled={aplicando}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {resultado && (
        <div className="atualizacao-massa-resultado">
          <p>{resultado.autoAplicados} work(s) updated.</p>
          <p>{resultado.pendentesGravados} candidate(s) added to the approval queue.</p>
          {resultado.erros.length > 0 && (
            <p className="execucao-status execucao-erro">{resultado.erros.length} failed: {resultado.erros.join(' · ')}</p>
          )}
        </div>
      )}

      <div className="fila-aprovacoes">
        <button
          type="button"
          className="fila-aprovacoes-toggle"
          onClick={() => setFilaAberta((v) => !v)}
          aria-expanded={filaAberta}
        >
          {filaAberta ? '▾' : '▸'} Approvals ({pendentes.length} pending)
        </button>

        {filaAberta && (
          <div className="fila-aprovacoes-corpo">
            {pendentes.length > 0 && (
              <input
                type="text"
                placeholder="Filter by work, candidate title or link…"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                style={{ marginBottom: 10, width: '100%' }}
              />
            )}

            {pendentesFiltrados.length > 0 && (
              <div className="fila-acoes-massa">
                <button type="button" className="fila-selecionar-grupo" onClick={alternarTodas} disabled={loteEmAndamento}>
                  {pendentesFiltrados.every((p) => selecionadas.has(p.id)) ? 'Deselect all' : 'Select all'}
                </button>
                {selecionadas.size > 0 && (
                  <>
                    <span>
                      {progressoLote
                        ? `${progressoLote.rotulo} ${progressoLote.feito}/${progressoLote.total}…`
                        : `${selecionadas.size} selected`}
                    </span>
                    <button type="button" onClick={() => executarLote('aprovar')} disabled={loteEmAndamento}>
                      Approve selected
                    </button>
                    <button type="button" onClick={() => executarLote('rejeitar')} disabled={loteEmAndamento}>
                      Reject selected
                    </button>
                  </>
                )}
              </div>
            )}

            {erroFila && <p className="execucao-status execucao-erro">{erroFila}</p>}

            {carregandoFila ? (
              <p className="fontes-vazio">Loading…</p>
            ) : pendentesFiltrados.length === 0 ? (
              <p className="fontes-vazio">Nothing to review.</p>
            ) : (
              <ul className="fontes-lista">
                {pendentesFiltrados.map((p) => (
                  <li key={p.id} className="fonte-item fonte-aprovacao">
                    <input
                      type="checkbox"
                      className="fonte-selecao"
                      checked={selecionadas.has(p.id)}
                      onChange={() => alternarSelecao(p.id)}
                      disabled={loteEmAndamento}
                      aria-label={`Select ${p.titulo_candidato}`}
                    />
                    <div className="fonte-aprovacao-info">
                      {p.obra ? (
                        <a href={`/obra/${p.obra.id}`} target="_blank" rel="noopener noreferrer" className="fonte-site-titulo">
                          {p.obra.titulo}
                        </a>
                      ) : (
                        <span className="fonte-site-titulo">(work removed)</span>
                      )}
                      {p.obra?.titulos_alternativos && p.obra.titulos_alternativos.length > 0 && (
                        <span className="scraper-data">Alt: {p.obra.titulos_alternativos.join(', ')}</span>
                      )}
                      <span className="scraper-data">
                        candidate “{p.titulo_candidato}” · {(p.score * 100).toFixed(0)}%
                      </span>
                      <a href={p.url_candidato} target="_blank" rel="noopener noreferrer" className="fonte-link">
                        {p.url_candidato}
                      </a>
                    </div>
                    <div className="fonte-acoes">
                      <button type="button" onClick={() => handleAprovar(p)} disabled={processandoItem === p.id || loteEmAndamento}>
                        {processandoItem === p.id ? 'Please wait…' : 'Approve'}
                      </button>
                      <button type="button" onClick={() => handleRejeitar(p)} disabled={processandoItem === p.id || loteEmAndamento}>
                        Reject
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="fila-aprovacoes">
        <button
          type="button"
          className="fila-aprovacoes-toggle"
          onClick={() => setBlacklistAberta((v) => !v)}
          aria-expanded={blacklistAberta}
        >
          {blacklistAberta ? '▾' : '▸'} Blacklist ({blacklist.length})
        </button>
        {blacklistAberta && (
          <div className="fila-aprovacoes-corpo">
            {blacklist.length === 0 ? (
              <p className="fontes-vazio">No rejected pairs.</p>
            ) : (
              <ul className="fontes-lista">
                {blacklist.map((b) => (
                  <li key={b.id} className="fonte-item">
                    <div className="fonte-aprovacao-info">
                      <span className="fonte-site-titulo">{obraPorId.get(b.obra_id) ?? b.obra_id}</span>
                      <a href={b.url} target="_blank" rel="noopener noreferrer" className="fonte-link">
                        {b.url}
                      </a>
                    </div>
                    <div className="fonte-acoes">
                      <button type="button" onClick={() => handleRemoverBlacklist(b.id)}>
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
