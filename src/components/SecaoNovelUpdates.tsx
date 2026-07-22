import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { db } from '../db/localDb';
import { updateObra } from '../db/repo';
import { mensagemDeErro, mensagemErroAcao } from '../lib/erros';
import { controlarScraper } from '../lib/scraperControl';
import { enriquecerTitulosAlternativos } from '../lib/novelupdates';
import { useScraperRun } from '../hooks/useScraperRun';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { StatusExecucaoScraper } from './StatusExecucaoScraper';

interface PendenteComObra {
  id: string;
  obra_id: string;
  novelupdates_url: string;
  titulo_encontrado: string;
  score: number;
  titulos_associados: string[] | null;
  obra: { id: string; titulo: string } | null;
}

/**
 * Seção "Novel Updates" da aba Updates (Bloco E5): dispara o scraper de Novel
 * Updates e exibe a fila de aprovação dos matches não-exatos. Approve grava
 * novelupdates_url na obra (via updateObra, que espelha na contraparte — E6),
 * enriquece Alternative titles (E4) e marca o pendente como aprovado; Reject
 * marca como reprovado (o scraper não reinsere a mesma URL — E5).
 */
export function SecaoNovelUpdates() {
  const { run, carregando, erro, recarregar } = useScraperRun('novelupdates');
  const rodando = run?.status === 'rodando';

  const [pendentes, setPendentes] = useState<PendenteComObra[]>([]);
  const [carregandoFila, setCarregandoFila] = useState(true);
  const [erroFila, setErroFila] = useState<string | null>(null);
  const [processando, setProcessando] = useState<string | null>(null);

  const carregarPendentes = useCallback(async () => {
    setCarregandoFila(true);
    setErroFila(null);
    const { data, error } = await supabase
      .from('novelupdates_pendentes')
      .select('id, obra_id, novelupdates_url, titulo_encontrado, score, titulos_associados, obra:obras(id, titulo)')
      .eq('status_aprovacao', 'pendente')
      .order('score', { ascending: false });
    if (error) {
      setErroFila(error.message);
    } else {
      setPendentes((data ?? []) as unknown as PendenteComObra[]);
    }
    setCarregandoFila(false);
  }, []);

  useEffect(() => {
    void carregarPendentes();
  }, [carregarPendentes]);

  const { executar: handleAcao, executando: acionando, erro: erroAcao } = useAsyncAction(
    useCallback(async () => {
      try {
        await controlarScraper('novelupdates', rodando ? 'stop' : 'start');
        await recarregar();
      } catch (err) {
        throw new Error(mensagemErroAcao(err));
      }
    }, [rodando, recarregar])
  );

  async function handleAprovar(p: PendenteComObra) {
    setProcessando(p.id);
    setErroFila(null);
    try {
      // Título alternativo atual da obra vem do estado local (fonte de verdade do app).
      const obra = await db.obras.get(p.obra_id);
      const novosTitulos = enriquecerTitulosAlternativos(obra?.titulos_alternativos ?? null, p.titulos_associados);
      // Uma chamada só: novelupdates_url e titulos_alternativos são ambos espelhados
      // na contraparte vinculada por updateObra (CAMPOS_ESPELHADOS — E4/E6).
      await updateObra(p.obra_id, {
        novelupdates_url: p.novelupdates_url,
        titulos_alternativos: novosTitulos.length > 0 ? novosTitulos : null,
      });
      const { error } = await supabase
        .from('novelupdates_pendentes')
        .update({ status_aprovacao: 'aprovado' })
        .eq('id', p.id);
      if (error) throw error;
      await carregarPendentes();
    } catch (err) {
      setErroFila(mensagemDeErro(err));
    } finally {
      setProcessando(null);
    }
  }

  async function handleReprovar(p: PendenteComObra) {
    setProcessando(p.id);
    setErroFila(null);
    try {
      const { error } = await supabase
        .from('novelupdates_pendentes')
        .update({ status_aprovacao: 'reprovado' })
        .eq('id', p.id);
      if (error) throw error;
      await carregarPendentes();
    } catch (err) {
      setErroFila(mensagemDeErro(err));
    } finally {
      setProcessando(null);
    }
  }

  return (
    <section className="atualizacao-secao">
      <h3>Novel Updates</h3>
      <p>
        Match your works against novelupdates.com. High-confidence matches are linked automatically and enrich the
        Alternative titles; the rest wait for your approval below.
      </p>

      <div className="scraper-controles">
        <button type="button" onClick={handleAcao} disabled={acionando}>
          {acionando ? 'Please wait…' : rodando ? 'Stop' : 'Find on Novel Updates'}
        </button>
      </div>
      {erroAcao && <p className="execucao-status execucao-erro">{erroAcao}</p>}

      <StatusExecucaoScraper run={run} carregando={carregando} erro={erro} />

      <h4 className="atualizacao-subtitulo">Approvals ({pendentes.length} pending)</h4>
      {erroFila && <p className="execucao-status execucao-erro">{erroFila}</p>}
      {carregandoFila ? (
        <p className="fontes-vazio">Loading…</p>
      ) : pendentes.length === 0 ? (
        <p className="fontes-vazio">Nothing to review.</p>
      ) : (
        <ul className="fontes-lista">
          {pendentes.map((p) => (
            <li key={p.id} className="fonte-item fonte-aprovacao">
              <div className="fonte-aprovacao-info">
                {p.obra ? (
                  <Link to={`/obra/${p.obra.id}`} className="fonte-site-titulo">
                    {p.obra.titulo}
                  </Link>
                ) : (
                  <span className="fonte-site-titulo">(work removed)</span>
                )}
                <span className="scraper-data">
                  matched “{p.titulo_encontrado}” · {p.score.toFixed(2)}
                </span>
                <a href={p.novelupdates_url} target="_blank" rel="noopener noreferrer" className="fonte-link">
                  {p.novelupdates_url}
                </a>
              </div>
              <div className="fonte-acoes">
                <button type="button" onClick={() => handleAprovar(p)} disabled={processando === p.id}>
                  {processando === p.id ? 'Please wait…' : 'Approve'}
                </button>
                <button type="button" onClick={() => handleReprovar(p)} disabled={processando === p.id}>
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
