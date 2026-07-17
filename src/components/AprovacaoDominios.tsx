import { useCallback, useEffect, useState } from 'react';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { aprovarDominio, listarDominiosPendentes, rejeitarDominio, type DominioPendente } from '../lib/scraperConfig';

function formatarData(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { dateStyle: 'medium' });
}

/**
 * Fila de aprovação de domínio (handout consolidado, Bloco C): domínios que
 * entraram em sites_suportados como pedido pendente (ativo=false) — vindos do
 * cadastro manual de uma fonte de domínio novo. Aprovar ativa o domínio e
 * dispara a detecção de adaptador; rejeitar manda para a blacklist e mantém
 * fora dos scrapers. A fonte que originou o pedido já está salva e clicável
 * na obra independentemente da decisão aqui.
 *
 * Um domínio pendente também pode sair daqui sozinho, sem clique nenhum: se a
 * detecção automática (disparada no cadastro, ou pelo botão "Detect adapters"
 * na fila "Domains without adapter") reconhecer um adaptador de verdade pra
 * ele, o domínio é promovido a aprovado direto (ver designar_adaptadores.py)
 * e some desta lista.
 */
export function AprovacaoDominios() {
  const [pendentes, setPendentes] = useState<DominioPendente[]>([]);
  const [processando, setProcessando] = useState<string | null>(null);

  const {
    executar: carregar,
    executando: carregando,
    erro: erroCarregar,
  } = useAsyncAction(
    useCallback(async () => {
      setPendentes(await listarDominiosPendentes());
    }, [])
  );

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const { executar: aprovar, erro: erroAprovar } = useAsyncAction(
    useCallback(
      async (d: DominioPendente) => {
        await aprovarDominio(d.id, d.nome);
        await carregar();
      },
      [carregar]
    )
  );

  const { executar: rejeitar, erro: erroRejeitar } = useAsyncAction(
    useCallback(
      async (d: DominioPendente) => {
        await rejeitarDominio(d.nome, 'Rejected from domain approval queue');
        await carregar();
      },
      [carregar]
    )
  );

  async function handleAprovar(d: DominioPendente) {
    setProcessando(d.id);
    await aprovar(d);
    setProcessando(null);
  }

  async function handleRejeitar(d: DominioPendente) {
    if (!confirm(`Reject ${d.nome}? It won't be suggested again and won't be scraped.`)) return;
    setProcessando(d.id);
    await rejeitar(d);
    setProcessando(null);
  }

  const erro = erroCarregar ?? erroAprovar ?? erroRejeitar;

  if (carregando) return <p className="execucao-status">Loading…</p>;
  if (erro) return <p className="execucao-status execucao-erro">Error: {erro}</p>;
  if (pendentes.length === 0) return <p className="execucao-status">No domains awaiting approval.</p>;

  return (
    <ul className="dominios-lista">
      {pendentes.map((d) => (
        <li key={d.id} className="dominio-item">
          <div className="dominio-cabecalho">
            <span className="dominio-nome">{d.nome}</span>
            {d.url_base && (
              <a href={d.url_base} target="_blank" rel="noreferrer" className="dominio-link">
                open
              </a>
            )}
            <span className="dominio-data">requested {formatarData(d.criado_em)}</span>
          </div>
          <div className="fonte-acoes">
            <button type="button" onClick={() => handleAprovar(d)} disabled={processando === d.id}>
              {processando === d.id ? 'Please wait…' : 'Approve'}
            </button>
            <button type="button" onClick={() => handleRejeitar(d)} disabled={processando === d.id}>
              Reject
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
