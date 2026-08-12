import { useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { StatusScraper } from './StatusScraper';
import { IconeLivro } from './Icones';
import { FavoritoBotao } from './FavoritoBotao';
import {
  BotaoAdicionarSource,
  CapaEditavel,
  CopiarTituloBotao,
  EstrelasEditaveis,
  MetaEdicao,
  NovelUpdatesEditavel,
  TituloEditavel,
} from './ObraCardEdicao';
import { updateObra } from '../db/repo';
import { percentualLido, temNovoCapitulo } from '../lib/obra';
import { dominioDeUrl } from '../lib/scraperConfig';
import type { Fonte, Obra } from '../types';

function Estrelas({ score }: { score: number | null }) {
  if (!score) return null;
  return <span className="estrelas">{'★'.repeat(score)}{'☆'.repeat(5 - score)}</span>;
}

function ProgressoBarra({ obra }: { obra: Obra }) {
  const pct = percentualLido(obra);
  if (pct == null || obra.ultimo_capitulo_lancado == null) return null;
  // Mesmo critério de percentualLido pro valor exposto a leitores de tela:
  // Finished sempre "cheio", mesmo se capitulo_atual estiver desatualizado.
  const atual = obra.status_leitura === 'Finished' ? obra.ultimo_capitulo_lancado : (obra.capitulo_atual ?? 0);
  return (
    <div
      className="obra-card-barra"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={obra.ultimo_capitulo_lancado}
      aria-valuenow={atual}
    >
      <div className="obra-card-barra-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Edição inline do capítulo lido (capitulo_atual) direto na lista, sem abrir o formulário. */
function CapituloAtualEditavel({ obra }: { obra: Obra }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');

  function abrir() {
    setValor(obra.capitulo_atual != null ? String(obra.capitulo_atual) : '');
    setEditando(true);
  }

  async function salvar() {
    const bruto = valor.trim();
    const novo = bruto === '' ? null : Number(bruto);
    if (novo !== null && Number.isNaN(novo)) {
      setEditando(false);
      return;
    }
    if (novo !== obra.capitulo_atual) {
      await updateObra(obra.id, { capitulo_atual: novo });
    }
    setEditando(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') void salvar();
    else if (e.key === 'Escape') setEditando(false);
  }

  if (editando) {
    return (
      <input
        className="cap-atual-input"
        type="number"
        step="any"
        autoFocus
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={salvar}
      />
    );
  }

  return (
    <button type="button" className="cap-atual-botao" onClick={abrir} title="Edit current chapter">
      ch. {obra.capitulo_atual ?? '—'}
    </button>
  );
}

/** Link + badges + status de uma fonte — conteúdo reaproveitado no <li> normal
 * e no <li> da última fonte (que também carrega o botão do Novel Updates). */
function ConteudoFonte({ fonte, sitesAtivos }: { fonte: Fonte; sitesAtivos?: Set<string> }) {
  const nomeSite = fonte.site || dominioDeUrl(fonte.url) || fonte.url;
  const naoMonitorada = !!sitesAtivos && !sitesAtivos.has(nomeSite.toLowerCase());
  return (
    <>
      <a href={fonte.url} target="_blank" rel="noreferrer">
        {nomeSite}
      </a>
      {naoMonitorada && (
        <span className="badge-nao-monitorada" title="Domain not approved for scraping">
          unmonitored
        </span>
      )}
      {fonte.ultimo_capitulo_detectado != null && <span> · ch. {fonte.ultimo_capitulo_detectado}</span>}
      <StatusScraper fonte={fonte} compact />
    </>
  );
}

/** Botão do Novel Updates no canto do card: link real se a obra tiver o
 * vínculo cadastrado, ou ícone translúcido e não clicável caso contrário.
 * No Edit mode os dois casos viram botão que abre o modal do NU. */
function NovelUpdatesBotao({ obra, modoEdicao }: { obra: Obra; modoEdicao?: boolean }) {
  if (modoEdicao) return <NovelUpdatesEditavel obra={obra} />;
  if (obra.novelupdates_url) {
    return (
      <a
        className="btn-icone obra-card-nu-botao"
        href={obra.novelupdates_url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open on Novel Updates"
        title="Open on Novel Updates"
      >
        <IconeLivro />
      </a>
    );
  }
  return (
    <span
      className="btn-icone obra-card-nu-botao obra-card-nu-botao-vazio"
      aria-hidden
      title="No Novel Updates link registered"
    >
      <IconeLivro />
    </span>
  );
}

interface Props {
  obra: Obra;
  fontes: Fonte[];
  /** Nomes dos domínios aprovados para scraping — fontes fora dessa lista ganham o badge "unmonitored". */
  sitesAtivos?: Set<string>;
  /** Edit mode da aba List: os mesmos blocos, com outro significado de clique (Handout 2, B4). */
  modoEdicao?: boolean;
}

/**
 * O layout do card NÃO muda entre os modos: mesmos blocos, mesma ordem, mesmas
 * dimensões. O que muda é o que cada elemento faz ao ser clicado e a presença
 * dos placeholders. O caminho comum (modo desligado) é o de sempre — os
 * subcomponentes de edição só são montados com o modo ligado.
 */
export function ObraCard({ obra, fontes, sitesAtivos, modoEdicao }: Props) {
  const novoCapitulo = temNovoCapitulo(obra);

  const conteudoCapa = (
    <>
      {obra.capa_url ? (
        <img src={obra.capa_url} alt="" loading="lazy" />
      ) : (
        <div className="obra-card-capa-placeholder">{obra.titulo.slice(0, 1).toUpperCase()}</div>
      )}
      {novoCapitulo && <span className="badge-novo-capitulo">new ch.</span>}
    </>
  );

  return (
    <div className="obra-card">
      {modoEdicao ? (
        <CapaEditavel obra={obra}>{conteudoCapa}</CapaEditavel>
      ) : (
        <div className="obra-card-capa" data-tipo={obra.tipo ?? ''}>
          {conteudoCapa}
        </div>
      )}
      <div className="obra-card-info">
        <div className="obra-card-titulo-linha">
          {modoEdicao ? (
            <>
              <TituloEditavel obra={obra} />
              <CopiarTituloBotao obra={obra} />
            </>
          ) : (
            <Link to={`/obra/${obra.id}`} className="obra-card-titulo">
              {obra.titulo}
            </Link>
          )}
          <FavoritoBotao obra={obra} className="obra-card-favorito-botao" />
        </div>
        <div className="obra-card-meta">
          {modoEdicao ? (
            <MetaEdicao obra={obra} />
          ) : (
            <>
              {obra.classificacao && (
                <span
                  className={`badge badge-classificacao ${obra.classificacao === 'R-18' ? 'badge-r18' : 'badge-r15'}`}
                >
                  {obra.classificacao}
                </span>
              )}
              {obra.status_publicacao && <span className="badge badge-pub">{obra.status_publicacao}</span>}
              {obra.fim_de_temporada && <span className="badge badge-eos">End of Season</span>}
              {obra.tipo && <span className="badge">{obra.tipo}</span>}
              {obra.status_leitura && <span className="badge badge-status">{obra.status_leitura}</span>}
            </>
          )}
        </div>
        <div className="obra-card-progresso">
          <CapituloAtualEditavel obra={obra} />
          {obra.ultimo_capitulo_lancado != null && ` / ${obra.ultimo_capitulo_lancado} available`}
        </div>
        <ProgressoBarra obra={obra} />
        {modoEdicao ? <EstrelasEditaveis obra={obra} /> : <Estrelas score={obra.score} />}

        {fontes.length > 0 ? (
          <ul className="obra-card-fontes">
            {fontes.map((f, indice) => {
              const ultima = indice === fontes.length - 1;
              return (
                <li key={f.id} className={ultima ? 'obra-card-fonte-ultima' : undefined}>
                  {ultima ? (
                    <>
                      <span className="obra-card-fonte-texto">
                        <ConteudoFonte fonte={f} sitesAtivos={sitesAtivos} />
                      </span>
                      <NovelUpdatesBotao obra={obra} modoEdicao={modoEdicao} />
                    </>
                  ) : (
                    <ConteudoFonte fonte={f} sitesAtivos={sitesAtivos} />
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="obra-card-nu-linha">
            <NovelUpdatesBotao obra={obra} modoEdicao={modoEdicao} />
          </div>
        )}

        {modoEdicao && <BotaoAdicionarSource obra={obra} />}
      </div>
    </div>
  );
}
