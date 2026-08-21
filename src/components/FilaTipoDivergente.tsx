import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { criarContraparteVinculada, deleteFonte, setFonteTipo } from '../db/repo';
import { familiaDeTipo } from '../lib/obra';
import { mensagemDeErro } from '../lib/erros';
import { tituloNoSite } from '../lib/site';
import { dominioDeUrl } from '../lib/scraperConfig';
import { useFontesTipoDivergente } from '../hooks/useFontesTipoDivergente';
import { useToast } from './Toast';
import { VinculoObraSelect } from './VinculoObraSelect';
import type { FonteTipoDivergente } from '../lib/fonteTipo';

interface ItemProps {
  item: FonteTipoDivergente;
}

/**
 * Uma fonte com tipo divergente da obra atual, com as 4 ações da fila (Bloco
 * B4 consolidado): Keep, Create, Move (auto-detectado via obra vinculada, com
 * busca manual como alternativa/override) e Discard.
 */
function ItemTipoDivergente({ item }: ItemProps) {
  const { fonte, obraAtual, obraCorrespondente } = item;
  const { mostrarToast } = useToast();
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [alvoManualId, setAlvoManualId] = useState('');

  const tipoLabel = fonte.tipo_detectado ?? '—';
  const alvoId = alvoManualId || obraCorrespondente?.id || '';

  async function executar(acao: () => Promise<void>) {
    setProcessando(true);
    setErro(null);
    try {
      await acao();
    } catch (err) {
      setErro(mensagemDeErro(err));
    } finally {
      setProcessando(false);
    }
  }

  function handleKeep() {
    void executar(async () => {
      await setFonteTipo(fonte.id, fonte.tipo_detectado);
      mostrarToast('Kept');
    });
  }

  function handleCreate() {
    void executar(async () => {
      if (!fonte.tipo_detectado) return;
      const nova = await criarContraparteVinculada(obraAtual, fonte.tipo_detectado);
      await setFonteTipo(fonte.id, fonte.tipo_detectado, nova.id);
      mostrarToast(`"${nova.titulo}" created and linked ✓`);
    });
  }

  function handleMove() {
    void executar(async () => {
      if (!alvoId) return;
      const obraDestino = alvoId === obraCorrespondente?.id ? obraCorrespondente : null;
      await setFonteTipo(fonte.id, fonte.tipo_detectado, alvoId);
      mostrarToast(`Source moved to "${obraDestino?.titulo ?? 'the selected work'}"`);
    });
  }

  function handleDiscard() {
    void executar(async () => {
      await deleteFonte(fonte.id);
      mostrarToast('Source discarded');
    });
  }

  return (
    <li className="fonte-item fonte-aprovacao">
      <div className="fonte-aprovacao-info">
        <span className="fonte-site-titulo">
          {fonte.site ?? dominioDeUrl(fonte.url)}: {tituloNoSite(fonte.url) || '—'}
        </span>
        <a href={fonte.url} target="_blank" rel="noreferrer" className="fonte-link" title={fonte.url}>
          {fonte.url}
        </a>
        <span className="scraper-data">
          detected as {tipoLabel}, but "{obraAtual.titulo}" is {obraAtual.tipo ?? '—'}
        </span>
        {obraCorrespondente && (
          <span className="scraper-data">
            Match found:{' '}
            <Link to={`/obra/${obraCorrespondente.id}`} target="_blank" rel="noreferrer">
              {obraCorrespondente.titulo}
            </Link>
          </span>
        )}
        <VinculoObraSelect
          value={alvoManualId}
          onChange={setAlvoManualId}
          excluirId={obraAtual.id}
          filtrar={(o) => familiaDeTipo(o.tipo) === fonte.tipo_detectado}
          placeholder="Search a work to move to…"
        />
      </div>
      {erro && <p className="execucao-status execucao-erro">{erro}</p>}
      <div className="fonte-acoes">
        <button type="button" onClick={handleKeep} disabled={processando}>
          Keep
        </button>
        <button type="button" onClick={handleCreate} disabled={processando}>
          Create
        </button>
        <button type="button" onClick={handleMove} disabled={processando || !alvoId}>
          Move
        </button>
        <button type="button" onClick={handleDiscard} disabled={processando}>
          Discard
        </button>
      </div>
    </li>
  );
}

/**
 * Fila "Mismatched source types" (Updates): lista toda fonte cujo tipo
 * detectado diverge da família da obra atual, agrupada por obra. Resolver
 * (Create/Move/Discard) some com o item; Keep deixa a fonte como está, então
 * ela continua aparecendo até a usuária decidir de fato.
 */
export function FilaTipoDivergente() {
  const lista = useFontesTipoDivergente();
  const [aberta, setAberta] = useState(false);
  const [progressoLote, setProgressoLote] = useState<{ feito: number; total: number } | null>(null);
  const [erroLote, setErroLote] = useState<string | null>(null);

  const grupos = useMemo(() => {
    const porObra = new Map<string, FonteTipoDivergente[]>();
    for (const item of lista ?? []) {
      const arr = porObra.get(item.obraAtual.id) ?? [];
      arr.push(item);
      porObra.set(item.obraAtual.id, arr);
    }
    return Array.from(porObra.values()).map((itens) => ({ obra: itens[0].obraAtual, itens }));
  }, [lista]);

  const obrasCount = grupos.length;
  const comMatch = useMemo(() => (lista ?? []).filter((d) => d.obraCorrespondente !== null), [lista]);
  const loteEmAndamento = progressoLote !== null;

  async function moverTodasCadastradas() {
    setErroLote(null);
    const falhas: string[] = [];
    for (let i = 0; i < comMatch.length; i++) {
      setProgressoLote({ feito: i + 1, total: comMatch.length });
      const { fonte, obraCorrespondente } = comMatch[i];
      try {
        await setFonteTipo(fonte.id, fonte.tipo_detectado, obraCorrespondente!.id);
      } catch (err) {
        falhas.push(mensagemDeErro(err));
      }
    }
    setProgressoLote(null);
    if (falhas.length > 0) setErroLote(`${falhas.length} failed: ${falhas.join(' · ')}`);
  }

  return (
    <div className="fila-aprovacoes">
      <button type="button" className="fila-aprovacoes-toggle" onClick={() => setAberta((v) => !v)} aria-expanded={aberta}>
        {aberta ? '▾' : '▸'} Mismatched source types ({obrasCount})
      </button>

      {aberta && (
        <div className="fila-aprovacoes-corpo">
          {comMatch.length > 0 && (
            <div className="fila-acoes-massa">
              <span>
                {progressoLote ? `Moving ${progressoLote.feito}/${progressoLote.total}…` : `${comMatch.length} with a match found`}
              </span>
              <button type="button" onClick={moverTodasCadastradas} disabled={loteEmAndamento}>
                Move all matched
              </button>
            </div>
          )}

          {erroLote && <p className="execucao-status execucao-erro">{erroLote}</p>}

          {grupos.length === 0 ? (
            <p className="fontes-vazio">Nothing here.</p>
          ) : (
            grupos.map(({ obra, itens }) => (
              <div key={obra.id} className="fontes-pendentes-grupo">
                <Link to={`/obra/${obra.id}`} className="fontes-pendentes-titulo">
                  {obra.titulo}
                </Link>
                <ul>
                  {itens.map((item) => (
                    <ItemTipoDivergente key={item.fonte.id} item={item} />
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
