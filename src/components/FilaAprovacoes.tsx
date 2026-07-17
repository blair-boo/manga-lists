import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../db/localDb';
import { setFonteAprovacao, setFonteTipo } from '../db/repo';
import { mensagemDeErro } from '../lib/erros';
import { tituloNoSite } from '../lib/site';
import { useDialogos } from './Dialogo';
import {
  adicionarDominioBloqueado,
  dominioDeUrl,
  listarDominiosBloqueados,
  removerDominioBloqueado,
  type DominioBloqueado,
} from '../lib/scraperConfig';
import type { FamiliaTipo, Fonte, Obra, StatusAprovacao } from '../types';

type Acao = 'aprovar' | 'rejeitar' | 'blacklist' | 'tipo';

const TIPO_FONTE_OPCOES: { valor: FamiliaTipo; rotulo: string }[] = [
  { valor: 'manga', rotulo: 'Manga' },
  { valor: 'novel', rotulo: 'Novel' },
];

type Filtro = StatusAprovacao | 'blacklist';

const FILTROS_BASE: { valor: StatusAprovacao; rotulo: string }[] = [
  { valor: 'pendente', rotulo: 'Pending' },
  { valor: 'aprovado', rotulo: 'Approved' },
  { valor: 'rejeitado', rotulo: 'Rejected' },
];

interface Props {
  titulo: string;
  /** Nomes dos sites suportados, para separar fontes de domínio suportado vs web. */
  sitesSuportados: string[];
  escopo: 'suportados' | 'novas';
  comBlacklist?: boolean;
}

/**
 * Fila de aprovações reutilizável (recolhida por padrão). Mostra fontes
 * descobertas automaticamente, filtradas por status, restritas ao escopo:
 *  - 'suportados': fontes em domínio de sites_suportados (vindas do update_obras)
 *  - 'novas': fontes fora dos sites suportados (fallback de busca web)
 * Com comBlacklist, adiciona o filtro extra que lista os domínios bloqueados.
 */
export function FilaAprovacoes({ titulo, sitesSuportados, escopo, comBlacklist }: Props) {
  const { confirmar } = useDialogos();
  const [aberta, setAberta] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>('pendente');
  const [blacklist, setBlacklist] = useState<DominioBloqueado[]>([]);
  const [processando, setProcessando] = useState<string | null>(null);
  const [acaoProcessando, setAcaoProcessando] = useState<Acao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [progressoLote, setProgressoLote] = useState<{ rotulo: string; feito: number; total: number } | null>(null);

  // Trocar de filtro ou fechar a fila limpa a seleção em massa.
  useEffect(() => {
    setSelecionadas(new Set());
  }, [filtro, aberta]);

  const fontes = useLiveQuery(() => db.fontes.filter((f) => f.descoberta_automaticamente).toArray(), []);
  const obras = useLiveQuery(() => db.obras.toArray(), []);

  const suportadosSet = useMemo(() => new Set(sitesSuportados), [sitesSuportados]);

  const pertence = useCallback(
    (f: Fonte) => {
      const ehSuportado = !!f.site && suportadosSet.has(f.site);
      return escopo === 'suportados' ? ehSuportado : !ehSuportado;
    },
    [suportadosSet, escopo]
  );

  const recarregarBlacklist = useCallback(() => {
    listarDominiosBloqueados()
      .then(setBlacklist)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (comBlacklist && aberta) recarregarBlacklist();
  }, [comBlacklist, aberta, filtro, recarregarBlacklist]);

  const contagemPorStatus = useMemo(() => {
    const mapa = new Map<StatusAprovacao, number>();
    for (const f of fontes ?? []) {
      if (!pertence(f)) continue;
      mapa.set(f.status_aprovacao, (mapa.get(f.status_aprovacao) ?? 0) + 1);
    }
    return mapa;
  }, [fontes, pertence]);

  const pendentesCount = contagemPorStatus.get('pendente') ?? 0;

  const grupos = useMemo(() => {
    if (filtro === 'blacklist') return [];
    const obraPorId = new Map((obras ?? []).map((o) => [o.id, o]));
    const filtradas = (fontes ?? []).filter((f) => f.status_aprovacao === filtro && pertence(f));
    const porObra = new Map<string, Fonte[]>();
    for (const f of filtradas) {
      const lista = porObra.get(f.obra_id) ?? [];
      lista.push(f);
      porObra.set(f.obra_id, lista);
    }
    return Array.from(porObra.entries())
      .map(([obraId, lista]) => ({ obra: obraPorId.get(obraId), fontes: lista }))
      .filter((g): g is { obra: Obra; fontes: Fonte[] } => !!g.obra)
      .sort((a, b) => a.obra.titulo.localeCompare(b.obra.titulo));
  }, [fontes, obras, filtro, pertence]);

  async function handleAprovacao(fonteId: string, status: StatusAprovacao, acao: Acao) {
    setProcessando(fonteId);
    setAcaoProcessando(acao);
    setErro(null);
    try {
      await setFonteAprovacao(fonteId, status);
    } catch (err) {
      setErro(mensagemDeErro(err));
    } finally {
      setProcessando(null);
      setAcaoProcessando(null);
    }
  }

  async function handleTipo(fonteId: string, tipo: FamiliaTipo | null) {
    setProcessando(fonteId);
    setAcaoProcessando('tipo');
    setErro(null);
    try {
      await setFonteTipo(fonteId, tipo);
    } catch (err) {
      setErro(mensagemDeErro(err));
    } finally {
      setProcessando(null);
      setAcaoProcessando(null);
    }
  }

  async function handleBlacklist(url: string, fonteId: string) {
    const dominio = dominioDeUrl(url);
    if (!dominio) return;
    const ok = await confirmar({
      titulo: 'Blacklist domain',
      mensagem: `Blacklist ${dominio}? It won't be suggested again for any work.`,
      confirmarRotulo: 'Blacklist',
      perigoso: true,
    });
    if (!ok) return;
    setProcessando(fonteId);
    setAcaoProcessando('blacklist');
    setErro(null);
    try {
      await adicionarDominioBloqueado(dominio, 'Blacklisted from approvals queue');
      await setFonteAprovacao(fonteId, 'rejeitado');
      recarregarBlacklist();
    } catch (err) {
      setErro(mensagemDeErro(err));
    } finally {
      setProcessando(null);
      setAcaoProcessando(null);
    }
  }

  async function handleUnblock(dominio: string) {
    await removerDominioBloqueado(dominio);
    recarregarBlacklist();
  }

  // --- Ações em massa (só no filtro 'pendente') ---

  const loteEmAndamento = progressoLote !== null;

  function alternarSelecao(fonteId: string) {
    setSelecionadas((prev) => {
      const s = new Set(prev);
      if (s.has(fonteId)) s.delete(fonteId);
      else s.add(fonteId);
      return s;
    });
  }

  function alternarGrupo(lista: Fonte[]) {
    const ids = lista.map((f) => f.id);
    setSelecionadas((prev) => {
      const s = new Set(prev);
      const todasSelecionadas = ids.every((id) => s.has(id));
      for (const id of ids) {
        if (todasSelecionadas) s.delete(id);
        else s.add(id);
      }
      return s;
    });
  }

  async function executarLote(status: StatusAprovacao) {
    // Cópia dos ids no clique: a lista é reativa (useLiveQuery) e os itens somem
    // da visão 'pendente' conforme mudam de status durante o lote — iterar sobre
    // a lista reativa pularia itens.
    const ids = Array.from(selecionadas);
    const rotulo = status === 'aprovado' ? 'Approving' : 'Rejecting';
    setErro(null);
    const falhas: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      setProgressoLote({ rotulo, feito: i + 1, total: ids.length });
      try {
        await setFonteAprovacao(ids[i], status);
      } catch (err) {
        falhas.push(mensagemDeErro(err));
      }
    }
    setProgressoLote(null);
    setSelecionadas(new Set());
    if (falhas.length > 0) setErro(`${falhas.length} failed: ${falhas.join(' · ')}`);
  }

  const filtros: { valor: Filtro; rotulo: string }[] = comBlacklist
    ? [...FILTROS_BASE, { valor: 'blacklist', rotulo: 'Blacklist' }]
    : FILTROS_BASE;

  return (
    <div className="fila-aprovacoes">
      <button
        type="button"
        className="fila-aprovacoes-toggle"
        onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta}
      >
        {aberta ? '▾' : '▸'} {titulo} ({pendentesCount} pending)
      </button>

      {aberta && (
        <div className="fila-aprovacoes-corpo">
          <div className="fila-filtros">
            {filtros.map((f) => (
              <button
                key={f.valor}
                type="button"
                className={`fila-filtro ${filtro === f.valor ? 'ativo' : ''}`}
                onClick={() => setFiltro(f.valor)}
              >
                {f.rotulo}
                <span className="status-chip-contagem">
                  {f.valor === 'blacklist' ? blacklist.length : contagemPorStatus.get(f.valor) ?? 0}
                </span>
              </button>
            ))}
          </div>

          {filtro === 'pendente' && selecionadas.size > 0 && (
            <div className="fila-acoes-massa">
              <span>
                {progressoLote
                  ? `${progressoLote.rotulo} ${progressoLote.feito}/${progressoLote.total}…`
                  : `${selecionadas.size} selected`}
              </span>
              <button type="button" onClick={() => executarLote('aprovado')} disabled={loteEmAndamento}>
                Approve selected
              </button>
              <button type="button" onClick={() => executarLote('rejeitado')} disabled={loteEmAndamento}>
                Reject selected
              </button>
            </div>
          )}

          {erro && <p className="execucao-status execucao-erro">{erro}</p>}

          {filtro === 'blacklist' ? (
            blacklist.length === 0 ? (
              <p className="fontes-vazio">No blocked domains.</p>
            ) : (
              <ul className="fontes-lista">
                {blacklist.map((d) => (
                  <li key={d.id} className="fonte-item">
                    <span>{d.dominio}</span>
                    {d.motivo && <span className="scraper-data">{d.motivo}</span>}
                    <div className="fonte-acoes">
                      <button type="button" onClick={() => handleUnblock(d.dominio)}>
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : grupos.length === 0 ? (
            <p className="fontes-vazio">Nothing here.</p>
          ) : (
            grupos.map(({ obra, fontes: lista }) => (
              <div key={obra.id} className="fontes-pendentes-grupo">
                <Link to={`/obra/${obra.id}`} className="fontes-pendentes-titulo">
                  {obra.titulo}
                </Link>
                {filtro === 'pendente' && (
                  <button
                    type="button"
                    className="fila-selecionar-grupo"
                    onClick={() => alternarGrupo(lista)}
                    disabled={loteEmAndamento}
                  >
                    {lista.every((f) => selecionadas.has(f.id)) ? 'Deselect all' : 'Select all'}
                  </button>
                )}
                <ul>
                  {lista.map((f) => (
                    <li key={f.id} className="fonte-item fonte-aprovacao">
                      {filtro === 'pendente' && (
                        <input
                          type="checkbox"
                          className="fonte-selecao"
                          checked={selecionadas.has(f.id)}
                          onChange={() => alternarSelecao(f.id)}
                          disabled={loteEmAndamento}
                          aria-label={`Select ${f.url}`}
                        />
                      )}
                      <div className="fonte-aprovacao-info">
                        <span className="fonte-site-titulo">
                          {f.site ?? dominioDeUrl(f.url)}: {tituloNoSite(f.url) || '—'}
                        </span>
                        <a href={f.url} target="_blank" rel="noreferrer" className="fonte-link" title={f.url}>
                          {f.url}
                        </a>
                        {f.ultimo_capitulo_detectado != null && (
                          <span className="scraper-data">detected ch. {f.ultimo_capitulo_detectado}</span>
                        )}
                      </div>
                      <select
                        className="fonte-tipo-select"
                        value={f.tipo_detectado ?? ''}
                        onChange={(e) => handleTipo(f.id, (e.target.value || null) as FamiliaTipo | null)}
                        title="Source type (manga/novel) — adjust before approving if the auto-detection got it wrong"
                        disabled={processando === f.id || loteEmAndamento}
                      >
                        <option value="">Type?</option>
                        {TIPO_FONTE_OPCOES.map((o) => (
                          <option key={o.valor} value={o.valor}>
                            {o.rotulo}
                          </option>
                        ))}
                      </select>
                      <div className="fonte-acoes">
                        {f.status_aprovacao !== 'aprovado' && (
                          <button
                            type="button"
                            onClick={() => handleAprovacao(f.id, 'aprovado', 'aprovar')}
                            disabled={processando === f.id || loteEmAndamento}
                          >
                            {processando === f.id && acaoProcessando === 'aprovar' ? 'Please wait…' : 'Approve'}
                          </button>
                        )}
                        {f.status_aprovacao !== 'rejeitado' && (
                          <button
                            type="button"
                            onClick={() => handleAprovacao(f.id, 'rejeitado', 'rejeitar')}
                            disabled={processando === f.id || loteEmAndamento}
                          >
                            {processando === f.id && acaoProcessando === 'rejeitar' ? 'Please wait…' : 'Reject'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleBlacklist(f.url, f.id)}
                          disabled={processando === f.id || loteEmAndamento}
                        >
                          {processando === f.id && acaoProcessando === 'blacklist' ? 'Please wait…' : 'Blacklist'}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
