import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react';
import { useBlocker } from 'react-router-dom';
import { db } from '../db/localDb';
import { removerValorLista, renomearValorLista } from '../lib/listas';
import { mensagemDeErro } from '../lib/erros';
import { useListaItensPorCategoria } from '../hooks/useListas';
import { useDialogos } from '../components/Dialogo';
import { useToast } from '../components/Toast';
import { ModalBase } from '../components/ModalBase';
import type { Categoria, ListaItem } from '../types';

type Pendente = { tipo: 'renomear'; valorNovo: string } | { tipo: 'excluir' };

function nomeEfetivo(item: ListaItem, pendentes: Record<string, Pendente>): string {
  const p = pendentes[item.id];
  return p?.tipo === 'renomear' ? p.valorNovo : item.valor;
}

interface SecaoProps {
  titulo: string;
  itens: ListaItem[];
  contagens: Map<string, number>;
  busca: string;
  pendentes: Record<string, Pendente>;
  edicaoAtivaId: string | null;
  rascunhoNome: string;
  selecionados: Set<string>;
  loteEmAndamento: boolean;
  onIniciarEdicao: (item: ListaItem) => void;
  onRascunhoChange: (valor: string) => void;
  onConfirmarEdicao: () => void;
  onCancelarEdicao: () => void;
  onMarcarExcluir: (id: string) => void;
  onDesfazerExcluir: (id: string) => void;
  onAlternarSelecao: (id: string) => void;
  onExcluirSelecionados: () => void;
}

/** Uma seção (Genres ou Tags): grid de 2 colunas com seleção em lote e edição inline. */
function Secao({
  titulo,
  itens,
  contagens,
  busca,
  pendentes,
  edicaoAtivaId,
  rascunhoNome,
  selecionados,
  loteEmAndamento,
  onIniciarEdicao,
  onRascunhoChange,
  onConfirmarEdicao,
  onCancelarEdicao,
  onMarcarExcluir,
  onDesfazerExcluir,
  onAlternarSelecao,
  onExcluirSelecionados,
}: SecaoProps) {
  const q = busca.trim().toLowerCase();
  const visiveis = itens
    .filter((item) => !q || nomeEfetivo(item, pendentes).toLowerCase().includes(q))
    .sort((a, b) => nomeEfetivo(a, pendentes).localeCompare(nomeEfetivo(b, pendentes)));

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      onConfirmarEdicao();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancelarEdicao();
    }
  }

  return (
    <section className="generos-tags-secao">
      <h2>
        {titulo} <span className="generos-tags-secao-contagem">({itens.length})</span>
      </h2>

      {selecionados.size > 0 && (
        <div className="generos-tags-acoes-massa">
          <span>{selecionados.size} selected</span>
          <button type="button" className="botao-perigoso" onClick={onExcluirSelecionados} disabled={loteEmAndamento}>
            Delete selected
          </button>
        </div>
      )}

      {visiveis.length === 0 ? (
        <p className="generos-tags-vazio">{itens.length === 0 ? 'Nothing here yet.' : 'No matches.'}</p>
      ) : (
        <div className="generos-tags-grid">
          {visiveis.map((item) => {
            const pendente = pendentes[item.id];
            const editando = edicaoAtivaId === item.id;
            const marcadoExcluir = pendente?.tipo === 'excluir';
            const uso = contagens.get(item.valor) ?? 0;

            if (editando) {
              return (
                <div key={item.id} className="generos-tags-item generos-tags-item-editando">
                  <input
                    value={rascunhoNome}
                    onChange={(e) => onRascunhoChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    aria-label={`Rename ${item.valor}`}
                  />
                  <button
                    type="button"
                    className="btn-icone"
                    onClick={onConfirmarEdicao}
                    title="Confirm rename"
                    aria-label="Confirm rename"
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    className="btn-icone"
                    onClick={onCancelarEdicao}
                    title="Cancel rename"
                    aria-label="Cancel rename"
                  >
                    ×
                  </button>
                </div>
              );
            }

            if (marcadoExcluir) {
              return (
                <div key={item.id} className="generos-tags-item generos-tags-item-excluir">
                  <span className="generos-tags-nome-riscado">{item.valor}</span>
                  <button type="button" onClick={() => onDesfazerExcluir(item.id)}>
                    Undo
                  </button>
                </div>
              );
            }

            return (
              <div key={item.id} className="generos-tags-item">
                <input
                  type="checkbox"
                  className="generos-tags-selecao"
                  checked={selecionados.has(item.id)}
                  onChange={() => onAlternarSelecao(item.id)}
                  disabled={loteEmAndamento}
                  aria-label={`Select ${item.valor}`}
                />
                <button
                  type="button"
                  className="generos-tags-nome"
                  onClick={() => onIniciarEdicao(item)}
                  disabled={loteEmAndamento}
                >
                  {nomeEfetivo(item, pendentes)}
                </button>
                {uso > 0 && (
                  <span className="generos-tags-uso" title={`Used in ${uso} work(s)`}>
                    {uso}
                  </span>
                )}
                <button
                  type="button"
                  className="btn-icone btn-icone-perigo"
                  onClick={() => onMarcarExcluir(item.id)}
                  disabled={loteEmAndamento}
                  title={`Delete ${item.valor}`}
                  aria-label={`Delete ${item.valor}`}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function alternarSelecao(setter: Dispatch<SetStateAction<Set<string>>>, id: string) {
  setter((prev) => {
    const s = new Set(prev);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    return s;
  });
}

/**
 * Settings > Genres/Tags: gerencia o catálogo (`listas`, categorias genero/tag)
 * usado pelo TagPicker em Cadastrar/Detalhe. Renomear/excluir aqui também
 * propaga pras obras que usam o valor (ver renomearValorLista/removerValorLista
 * em lib/listas.ts, RPCs da migration 0020) — arrays soltos em obras.generos/
 * tags não têm FK, então sem essa propagação um valor editado ficaria órfão.
 * Nada é enviado ao servidor até Save: até lá, tudo fica em `pendentes` (draft
 * local por item, indexado pelo id da linha em `listas`).
 */
export function GenerosTagsPage() {
  const { confirmar } = useDialogos();
  const { mostrarToast } = useToast();

  const generos = useListaItensPorCategoria('genero');
  const tags = useListaItensPorCategoria('tag');
  const obras = useLiveQuery(() => db.obras.toArray(), []);

  const [busca, setBusca] = useState('');
  const [pendentes, setPendentes] = useState<Record<string, Pendente>>({});
  const [edicaoAtivaId, setEdicaoAtivaId] = useState<string | null>(null);
  const [rascunhoNome, setRascunhoNome] = useState('');
  const [selecionadosGeneros, setSelecionadosGeneros] = useState<Set<string>>(new Set());
  const [selecionadosTags, setSelecionadosTags] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);
  const [progresso, setProgresso] = useState<{ feito: number; total: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const haAlteracoes = Object.keys(pendentes).length > 0;

  const contagens = useMemo(() => {
    const generosMap = new Map<string, number>();
    const tagsMap = new Map<string, number>();
    for (const obra of obras ?? []) {
      for (const g of obra.generos ?? []) generosMap.set(g, (generosMap.get(g) ?? 0) + 1);
      for (const t of obra.tags ?? []) tagsMap.set(t, (tagsMap.get(t) ?? 0) + 1);
    }
    return { generos: generosMap, tags: tagsMap };
  }, [obras]);

  const contagemDe = useCallback(
    (categoria: Categoria, valor: string): number =>
      (categoria === 'genero' ? contagens.generos : contagens.tags).get(valor) ?? 0,
    [contagens]
  );

  // Guarda contra sair da página com alterações pendentes: navegação interna via
  // useBlocker (mesmo padrão de DetalheObraPage) + beforeunload pra fechar/recarregar
  // a aba do navegador.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => haAlteracoes && currentLocation.pathname !== nextLocation.pathname
  );

  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (haAlteracoes) {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [haAlteracoes]);

  function iniciarEdicao(item: ListaItem) {
    setEdicaoAtivaId(item.id);
    setRascunhoNome(nomeEfetivo(item, pendentes));
  }

  function cancelarEdicao() {
    setEdicaoAtivaId(null);
    setRascunhoNome('');
  }

  function confirmarEdicao() {
    if (!edicaoAtivaId) return;
    const id = edicaoAtivaId;
    const item = [...generos, ...tags].find((i) => i.id === id);
    const novo = rascunhoNome.trim();
    if (item && novo && novo !== item.valor) {
      setPendentes((atual) => ({ ...atual, [id]: { tipo: 'renomear', valorNovo: novo } }));
    } else if (item) {
      // Voltou pro nome original (ou ficou vazio): não há mais nada pendente pra esse item.
      setPendentes((atual) => {
        const copia = { ...atual };
        delete copia[id];
        return copia;
      });
    }
    cancelarEdicao();
  }

  function marcarExcluir(id: string) {
    setPendentes((atual) => ({ ...atual, [id]: { tipo: 'excluir' } }));
    setSelecionadosGeneros((prev) => {
      if (!prev.has(id)) return prev;
      const s = new Set(prev);
      s.delete(id);
      return s;
    });
    setSelecionadosTags((prev) => {
      if (!prev.has(id)) return prev;
      const s = new Set(prev);
      s.delete(id);
      return s;
    });
  }

  function desfazerExcluir(id: string) {
    setPendentes((atual) => {
      const copia = { ...atual };
      delete copia[id];
      return copia;
    });
  }

  function excluirSelecionados(selecionados: Set<string>, limpar: () => void) {
    if (selecionados.size === 0) return;
    setPendentes((atual) => {
      const copia = { ...atual };
      for (const id of selecionados) copia[id] = { tipo: 'excluir' };
      return copia;
    });
    limpar();
  }

  function descartar() {
    setPendentes({});
    setSelecionadosGeneros(new Set());
    setSelecionadosTags(new Set());
    cancelarEdicao();
    setErro(null);
  }

  const salvar = useCallback(async (): Promise<boolean> => {
    const todosItens = [...generos, ...tags];
    const porId = new Map(todosItens.map((i) => [i.id, i]));
    const operacoes = Object.entries(pendentes)
      .map(([id, pendente]) => {
        const item = porId.get(id);
        return item ? { item, pendente } : null;
      })
      .filter((v): v is { item: ListaItem; pendente: Pendente } => v !== null);

    if (operacoes.length === 0) return true;

    const exclusoes = operacoes.filter((o) => o.pendente.tipo === 'excluir');
    if (exclusoes.length > 0) {
      const totalUsos = exclusoes.reduce((soma, o) => soma + contagemDe(o.item.categoria, o.item.valor), 0);
      const ok = await confirmar({
        titulo: 'Delete items',
        mensagem: `Delete ${exclusoes.length} item(s)${
          totalUsos > 0 ? `, used a total of ${totalUsos} time(s) across your works` : ''
        }? This also removes them from every work that has them.`,
        confirmarRotulo: 'Delete',
        perigoso: true,
      });
      if (!ok) return false;
    }

    setSalvando(true);
    setErro(null);
    const falhas: string[] = [];
    const sucesso: string[] = [];
    let renomeados = 0;
    let excluidos = 0;
    for (let i = 0; i < operacoes.length; i++) {
      const { item, pendente } = operacoes[i];
      setProgresso({ feito: i + 1, total: operacoes.length });
      try {
        if (pendente.tipo === 'renomear') {
          await renomearValorLista(item.categoria, item.valor, pendente.valorNovo);
          renomeados++;
        } else {
          await removerValorLista(item.categoria, item.valor);
          excluidos++;
        }
        sucesso.push(item.id);
      } catch (err) {
        falhas.push(`${item.valor}: ${mensagemDeErro(err)}`);
      }
    }
    setProgresso(null);
    setSalvando(false);
    setPendentes((atual) => {
      const copia = { ...atual };
      for (const id of sucesso) delete copia[id];
      return copia;
    });

    if (falhas.length > 0) {
      setErro(`${falhas.length} failed: ${falhas.join(' · ')}`);
      return false;
    }
    const partes: string[] = [];
    if (renomeados > 0) partes.push(`${renomeados} renamed`);
    if (excluidos > 0) partes.push(`${excluidos} deleted`);
    mostrarToast(partes.length > 0 ? partes.join(', ') : 'Saved');
    return true;
  }, [generos, tags, pendentes, contagemDe, confirmar, mostrarToast]);

  const desabilitarAcoes = salvando || edicaoAtivaId !== null;

  return (
    <div className="generos-tags-pagina">
      <div className="generos-tags-topo">
        <div className="generos-tags-cabecalho">
          <h1>Genres/Tags</h1>
          <p className="generos-tags-subtitulo">
            Rename or delete catalog values — changes also apply to every work that uses them.
          </p>
        </div>

        <div className="generos-tags-barra">
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Search genres and tags…"
            className="generos-tags-busca"
            aria-label="Search genres and tags"
          />
          <div className="generos-tags-barra-acoes">
            {progresso && (
              <span className="generos-tags-progresso">
                Saving {progresso.feito}/{progresso.total}…
              </span>
            )}
            <button type="button" onClick={descartar} disabled={!haAlteracoes || desabilitarAcoes}>
              Discard
            </button>
            <button type="button" onClick={() => void salvar()} disabled={!haAlteracoes || desabilitarAcoes}>
              {salvando ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {erro && <p className="generos-tags-erro">{erro}</p>}
      </div>

      <div className="generos-tags-conteudo">
        <Secao
          titulo="Genres"
          itens={generos}
          contagens={contagens.generos}
          busca={busca}
          pendentes={pendentes}
          edicaoAtivaId={edicaoAtivaId}
          rascunhoNome={rascunhoNome}
          selecionados={selecionadosGeneros}
          loteEmAndamento={salvando}
          onIniciarEdicao={iniciarEdicao}
          onRascunhoChange={setRascunhoNome}
          onConfirmarEdicao={confirmarEdicao}
          onCancelarEdicao={cancelarEdicao}
          onMarcarExcluir={marcarExcluir}
          onDesfazerExcluir={desfazerExcluir}
          onAlternarSelecao={(id) => alternarSelecao(setSelecionadosGeneros, id)}
          onExcluirSelecionados={() => excluirSelecionados(selecionadosGeneros, () => setSelecionadosGeneros(new Set()))}
        />
        <Secao
          titulo="Tags"
          itens={tags}
          contagens={contagens.tags}
          busca={busca}
          pendentes={pendentes}
          edicaoAtivaId={edicaoAtivaId}
          rascunhoNome={rascunhoNome}
          selecionados={selecionadosTags}
          loteEmAndamento={salvando}
          onIniciarEdicao={iniciarEdicao}
          onRascunhoChange={setRascunhoNome}
          onConfirmarEdicao={confirmarEdicao}
          onCancelarEdicao={cancelarEdicao}
          onMarcarExcluir={marcarExcluir}
          onDesfazerExcluir={desfazerExcluir}
          onAlternarSelecao={(id) => alternarSelecao(setSelecionadosTags, id)}
          onExcluirSelecionados={() => excluirSelecionados(selecionadosTags, () => setSelecionadosTags(new Set()))}
        />
      </div>

      {blocker.state === 'blocked' && (
        // Mesmo padrão de DetalheObraPage: o X (via onFechar) equivale a "Keep
        // editing", nunca ao caminho destrutivo.
        <ModalBase aberto rotulo="Unsaved changes" onFechar={() => blocker.reset()}>
          <p>You have unsaved changes to genres/tags.</p>
          <div className="modal-acoes">
            <button
              type="button"
              onClick={async () => {
                const ok = await salvar();
                if (ok) blocker.proceed();
              }}
            >
              Save and leave
            </button>
            <button
              type="button"
              onClick={() => {
                descartar();
                blocker.proceed();
              }}
            >
              Discard and leave
            </button>
            <button type="button" onClick={() => blocker.reset()}>
              Keep editing
            </button>
          </div>
        </ModalBase>
      )}
    </div>
  );
}
