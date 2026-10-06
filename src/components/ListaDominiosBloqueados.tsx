import { useCallback, useEffect, useState } from 'react';
import { mensagemErroAcao } from '../lib/erros';
import {
  listarDominiosBloqueados,
  removerDominioBloqueado,
  type DominioBloqueado,
} from '../lib/scraperConfig';
import { IconeBlacklistTitulo } from './Icones';

/** Blacklist de fontes (domínios que a busca nunca sugere), recolhida por padrão. */
export function ListaDominiosBloqueados() {
  const [aberta, setAberta] = useState(false);
  const [dominios, setDominios] = useState<DominioBloqueado[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(() => {
    listarDominiosBloqueados()
      .then((d) => {
        setDominios(d);
        setErro(null);
      })
      .catch((err) => setErro(mensagemErroAcao(err)));
  }, []);

  useEffect(() => {
    if (aberta) recarregar();
  }, [aberta, recarregar]);

  async function remover(dominio: string) {
    try {
      await removerDominioBloqueado(dominio);
      recarregar();
    } catch (err) {
      setErro(mensagemErroAcao(err));
    }
  }

  return (
    <div className="fila-aprovacoes">
      <button
        type="button"
        className="fila-aprovacoes-toggle"
        onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta}
      >
        <IconeBlacklistTitulo /> Source blacklist
      </button>
      {aberta && (
        <div className="fila-aprovacoes-corpo">
          {erro && <p className="execucao-status execucao-erro">{erro}</p>}
          {dominios.length === 0 ? (
            <p className="fontes-vazio">No blocked domains.</p>
          ) : (
            <ul className="fontes-lista">
              {dominios.map((d) => (
                <li key={d.id} className="fonte-item">
                  <span>{d.dominio}</span>
                  {d.motivo && <span className="scraper-data">{d.motivo}</span>}
                  <div className="fonte-acoes">
                    <button type="button" onClick={() => remover(d.dominio)}>
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
  );
}
