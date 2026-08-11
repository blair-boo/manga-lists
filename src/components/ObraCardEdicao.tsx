import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../db/localDb';
import { deleteFonte, encontrarObraDuplicada, type NovaObra } from '../db/repo';
import type { ObraDuplicada } from '../lib/duplicatas';
import { useListasPorCategoria } from '../hooks/useListas';
import { useSitesAtivos } from '../hooks/useSitesAtivos';
import { adicionarFonteNaObra } from '../lib/adicionarFonte';
import { deletarCapa } from '../lib/capaStorage';
import { mensagemDeErro } from '../lib/erros';
import { salvarCamposObra } from '../lib/salvarObra';
import { dominioDeUrl, urlNormalizada } from '../lib/site';
import { ModalBase } from './ModalBase';
import { TagPicker } from './TagPicker';
import { useToast } from './Toast';
import { useDialogos } from './Dialogo';
import { useUploadCapa } from './CapaUploader';
import { useModoEdicao } from './ModoEdicaoContext';
import { IconeCopiar, IconeLivro } from './Icones';
import type { Categoria, Classificacao, Fonte, Obra, StatusLeitura, StatusPublicacao, Tipo } from '../types';

/**
 * Superfícies editáveis do card no Edit mode (Handout 2, Blocos B4 e B5).
 * Tudo aqui só é montado com o modo ligado — o ObraCard segue sendo o
 * componente de layout e escolhe entre o subcomponente normal e o de edição.
 *
 * Gravação é imediata: cada confirmação grava na hora pelo caminho normal do
 * app (salvarCamposObra -> updateObra -> Dexie + syncQueue). Não existe buffer
 * de alterações pendentes; sair do modo apenas sai do modo.
 */

/**
 * Enquanto o modal está montado, a obra fica "fixada": a lista não a remove
 * por deixar de bater um filtro ativo (ex.: ganhar uma fonte com "Unsourced"
 * ligado), o que antes desmontava o card — e o modal junto — no meio da
 * edição. Todo modal de campo do card usa isso.
 */
function useFixarObraEnquantoAberto(obraId: string): void {
  const { fixarObra, desafixarObra } = useModoEdicao();
  useEffect(() => {
    fixarObra(obraId);
    return () => desafixarObra(obraId);
  }, [obraId, fixarObra, desafixarObra]);
}

/** Grava um patch da obra com toast de sucesso/erro — o "recibo" que substitui o salvar ao sair. */
function useSalvarCampos() {
  const { mostrarToast } = useToast();
  return useCallback(
    async (obra: Obra, changes: Partial<NovaObra>) => {
      try {
        await salvarCamposObra(obra, changes, (m) => mostrarToast(`Could not rename cover: ${m}`, 'erro'));
        mostrarToast('Saved ✓');
      } catch (err) {
        mostrarToast(mensagemDeErro(err), 'erro');
      }
    },
    [mostrarToast]
  );
}

// --- Título -----------------------------------------------------------------

const DEBOUNCE_DUPLICATA_MS = 400;

function ModalTitulo({ obra, onFechar }: { obra: Obra; onFechar: () => void }) {
  useFixarObraEnquantoAberto(obra.id);
  const salvar = useSalvarCampos();
  const [titulo, setTitulo] = useState(obra.titulo);
  const [alternativos, setAlternativos] = useState<string[]>(obra.titulos_alternativos ?? []);
  const [duplicada, setDuplicada] = useState<ObraDuplicada | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Checagem de duplicata com debounce. excluirId é obrigatório aqui: a obra
  // editada já existe no banco, e sem ele toda edição acusaria duplicata
  // contra ela mesma. Título inalterado não é checado — a suspeita já existiria
  // antes desta edição e o aviso só atrapalharia.
  useEffect(() => {
    const alvo = titulo.trim();
    if (!alvo || alvo.toLowerCase() === obra.titulo.trim().toLowerCase()) {
      setDuplicada(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void encontrarObraDuplicada(alvo, obra.id).then(setDuplicada);
    }, DEBOUNCE_DUPLICATA_MS);
    return () => clearTimeout(timer);
  }, [titulo, obra.id, obra.titulo]);

  const bloqueado = duplicada?.exata === true;

  async function handleSalvar(e: FormEvent) {
    e.preventDefault();
    const limpo = titulo.trim();
    if (!limpo || bloqueado || salvando) return;
    setSalvando(true);
    await salvar(obra, {
      titulo: limpo,
      titulos_alternativos: alternativos.length > 0 ? alternativos : null,
    });
    onFechar();
  }

  return (
    <ModalBase aberto rotulo="Edit title" onFechar={onFechar} classe="modal-edicao">
      <h3 className="modal-titulo">Edit title</h3>
      <form onSubmit={handleSalvar}>
        <label>
          Title
          <input type="text" value={titulo} onChange={(e) => setTitulo(e.target.value)} data-autofocus />
        </label>

        {duplicada && (
          <p className={`modal-aviso${bloqueado ? ' modal-aviso-bloqueio' : ''}`}>
            {bloqueado ? 'Another work already uses this exact title: ' : 'Possible duplicate: '}
            <Link to={`/obra/${duplicada.obra.id}`}>{duplicada.obra.titulo}</Link>
          </p>
        )}

        <TagPicker label="Associated Names" value={alternativos} options={[]} onChange={setAlternativos} />

        <div className="modal-acoes">
          <button type="submit" disabled={!titulo.trim() || bloqueado || salvando}>
            {salvando ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="botao-secundario" onClick={onFechar}>
            Cancel
          </button>
        </div>
      </form>
    </ModalBase>
  );
}

/**
 * Título no modo: <button>, não um Link com preventDefault — um <a> continuaria
 * abrindo por clique do meio, long press no iOS e "abrir em nova aba", quebrando
 * a promessa de que o título não navega no modo.
 */
export function TituloEditavel({ obra }: { obra: Obra }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button
        type="button"
        className="obra-card-titulo obra-card-titulo-editavel"
        onClick={() => setAberto(true)}
        title="Edit title"
      >
        {obra.titulo}
      </button>
      {aberto && <ModalTitulo obra={obra} onFechar={() => setAberto(false)} />}
    </>
  );
}

/** Copia o título da obra pro clipboard — só ícone, ao lado do título no modo. */
export function CopiarTituloBotao({ obra }: { obra: Obra }) {
  const { mostrarToast } = useToast();

  async function copiar() {
    try {
      await navigator.clipboard.writeText(obra.titulo);
      mostrarToast('Title copied ✓');
    } catch (err) {
      mostrarToast(mensagemDeErro(err), 'erro');
    }
  }

  return (
    <button
      type="button"
      className="btn-icone obra-card-copiar-titulo-botao"
      onClick={() => void copiar()}
      aria-label="Copy title"
      title="Copy title"
    >
      <IconeCopiar />
    </button>
  );
}

// --- Capa -------------------------------------------------------------------

/** Menu de opções da capa (aparece só quando já existe uma): trocar ou
 * remover. Remover apaga o arquivo no Storage antes de limpar capa_url — se o
 * Storage falhar, a gravação nem acontece, então o card nunca fica com
 * capa_url null apontando pra um arquivo que na real ainda existe (e
 * vice-versa: nunca soltamos um arquivo órfão por engano). */
function ModalCapa({
  obra,
  onFechar,
  onTrocar,
}: {
  obra: Obra;
  onFechar: () => void;
  onTrocar: () => void;
}) {
  useFixarObraEnquantoAberto(obra.id);
  const salvar = useSalvarCampos();
  const { mostrarToast } = useToast();
  const { confirmar } = useDialogos();
  const [removendo, setRemovendo] = useState(false);

  async function handleRemover() {
    const ok = await confirmar({
      titulo: 'Remove cover',
      mensagem: `Remove the cover of "${obra.titulo}"? This deletes the image file too.`,
      confirmarRotulo: 'Remove',
      perigoso: true,
    });
    if (!ok) return;
    setRemovendo(true);
    try {
      if (obra.capa_url) await deletarCapa(obra.capa_url);
      await salvar(obra, { capa_url: null });
      onFechar();
    } catch (err) {
      mostrarToast(mensagemDeErro(err), 'erro');
    } finally {
      setRemovendo(false);
    }
  }

  return (
    <ModalBase aberto rotulo="Cover" onFechar={onFechar} classe="modal-edicao">
      <h3 className="modal-titulo">Cover</h3>
      <div className="modal-acoes">
        <button type="button" onClick={onTrocar}>
          Change cover
        </button>
        <button type="button" className="botao-perigoso" onClick={handleRemover} disabled={removendo}>
          {removendo ? 'Removing…' : 'Remove cover'}
        </button>
        <button type="button" className="botao-secundario" onClick={onFechar}>
          Cancel
        </button>
      </div>
    </ModalBase>
  );
}

/** A capa inteira vira o alvo de clique. Com capa já cadastrada, abre o menu
 * (trocar/remover); sem capa, não há o que remover — vai direto pro seletor
 * de arquivo, como antes. O conteúdo (img/placeholder) vem do ObraCard, pra
 * não duplicar a marcação entre os dois modos. */
export function CapaEditavel({ obra, children }: { obra: Obra; children: ReactNode }) {
  const salvar = useSalvarCampos();
  const { mostrarToast } = useToast();
  const [menuAberto, setMenuAberto] = useState(false);
  const { enviando, erro, abrirSeletor, inputProps } = useUploadCapa({
    titulo: obra.titulo,
    tipo: obra.tipo,
    capaAtual: obra.capa_url,
    onUploaded: (url) => void salvar(obra, { capa_url: url }),
  });

  // Erro de upload vira toast: não há espaço no card pra texto de erro.
  useEffect(() => {
    if (erro) mostrarToast(erro, 'erro');
  }, [erro, mostrarToast]);

  function handleClick() {
    if (obra.capa_url) setMenuAberto(true);
    else abrirSeletor();
  }

  return (
    <>
      {/* O menu fica FORA desta div (irmão, não filho): se ficasse dentro, o
          clique nos botões do modal borbulharia até este onClick e reabriria
          o menu ou disparava o seletor de arquivo sem querer. */}
      <div
        className={`obra-card-capa obra-card-capa-editavel${enviando ? ' enviando' : ''}`}
        data-tipo={obra.tipo ?? ''}
        role="button"
        tabIndex={0}
        aria-label={obra.capa_url ? 'Cover options' : 'Add cover'}
        title={obra.capa_url ? 'Cover options' : 'Add cover'}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
      >
        {children}
        <input {...inputProps} />
      </div>
      {menuAberto && (
        <ModalCapa
          obra={obra}
          onFechar={() => setMenuAberto(false)}
          onTrocar={() => {
            setMenuAberto(false);
            abrirSeletor();
          }}
        />
      )}
    </>
  );
}

// --- Novel Updates ----------------------------------------------------------

function ModalNovelUpdates({ obra, onFechar }: { obra: Obra; onFechar: () => void }) {
  useFixarObraEnquantoAberto(obra.id);
  const salvar = useSalvarCampos();
  const { mostrarToast } = useToast();
  const { confirmar } = useDialogos();
  const [url, setUrl] = useState(obra.novelupdates_url ?? '');

  // novelupdates_url está em CAMPOS_ESPELHADOS: a contraparte vinculada recebe
  // o mesmo valor sozinha, sem replicar nada aqui.
  async function handleSalvar(e: FormEvent) {
    e.preventDefault();
    const limpo = url.trim();
    if (!limpo) return;
    if (!/novelupdates\.com/i.test(limpo)) {
      mostrarToast("That doesn't look like a novelupdates.com URL", 'info');
      return;
    }
    await salvar(obra, { novelupdates_url: limpo });
    onFechar();
  }

  async function handleRemover() {
    const ok = await confirmar({
      titulo: 'Remove Novel Updates link',
      mensagem: 'Remove the Novel Updates link from this work?',
      confirmarRotulo: 'Remove',
    });
    if (!ok) return;
    await salvar(obra, { novelupdates_url: null });
    onFechar();
  }

  return (
    <ModalBase aberto rotulo="Novel Updates link" onFechar={onFechar} classe="modal-edicao">
      <h3 className="modal-titulo">Novel Updates link</h3>
      <form onSubmit={handleSalvar}>
        <label>
          URL
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.novelupdates.com/…"
            data-autofocus
          />
        </label>
        <div className="modal-acoes">
          <button type="submit" disabled={!url.trim()}>
            Save
          </button>
          {obra.novelupdates_url && (
            <button type="button" className="botao-perigoso" onClick={handleRemover}>
              Remove
            </button>
          )}
          <button type="button" className="botao-secundario" onClick={onFechar}>
            Cancel
          </button>
        </div>
      </form>
    </ModalBase>
  );
}

/** Botão do NU no modo: com ou sem link, abre o mesmo modal. Sem link ele fica
 * translúcido (0.55, não o 0.35 do inerte) — é alvo de toque, não indicador. */
export function NovelUpdatesEditavel({ obra }: { obra: Obra }) {
  const [aberto, setAberto] = useState(false);
  const temLink = !!obra.novelupdates_url;
  const rotulo = temLink ? 'Edit Novel Updates link' : 'Add Novel Updates link';

  return (
    <>
      <button
        type="button"
        className={`btn-icone obra-card-nu-botao${temLink ? '' : ' obra-card-nu-botao-vazio-editavel'}`}
        onClick={() => setAberto(true)}
        aria-label={rotulo}
        title={rotulo}
      >
        <IconeLivro />
      </button>
      {aberto && <ModalNovelUpdates obra={obra} onFechar={() => setAberto(false)} />}
    </>
  );
}

// --- Seleção de valor de lista (Type / Reading / Publication) ----------------

/** Opções como botões, não <select>: no modal, com poucas opções, o toque
 * direto é melhor no celular. Selecionar grava e fecha — o X cobre a desistência. */
function ModalSelecao({
  obraId,
  rotulo,
  categoria,
  valorAtual,
  onSelecionar,
  onFechar,
}: {
  obraId: string;
  rotulo: string;
  categoria: Categoria;
  valorAtual: string | null;
  onSelecionar: (valor: string | null) => void;
  onFechar: () => void;
}) {
  useFixarObraEnquantoAberto(obraId);
  const opcoes = useListasPorCategoria(categoria);

  return (
    <ModalBase aberto rotulo={rotulo} onFechar={onFechar} classe="modal-edicao">
      <h3 className="modal-titulo">{rotulo}</h3>
      <div className="modal-opcoes">
        {opcoes.map((v) => (
          <button
            key={v}
            type="button"
            className={`modal-opcao${v === valorAtual ? ' ativa' : ''}`}
            onClick={() => onSelecionar(v)}
          >
            {v}
          </button>
        ))}
        <button
          type="button"
          className={`modal-opcao modal-opcao-nenhum${valorAtual == null ? ' ativa' : ''}`}
          onClick={() => onSelecionar(null)}
        >
          None
        </button>
      </div>
    </ModalBase>
  );
}

// --- Badges e placeholders --------------------------------------------------

type CampoModal = 'tipo' | 'leitura' | 'publicacao';

/** Badge preenchido (clicável) ou chip tracejado com o rótulo do campo vazio. */
function CampoBadge({
  valor,
  rotulo,
  classe,
  onClick,
}: {
  valor: string | null;
  rotulo: string;
  classe?: string;
  onClick: () => void;
}) {
  if (valor) {
    return (
      <button type="button" className={`badge badge-editavel ${classe ?? ''}`} onClick={onClick} title={`Edit ${rotulo}`}>
        {valor}
      </button>
    );
  }
  return (
    <button type="button" className="chip-vazio" onClick={onClick} title={`Set ${rotulo}`}>
      {rotulo}
    </button>
  );
}

/**
 * A .obra-card-meta no modo mostra sempre uma posição por campo editável, na
 * ordem Age, Publication, EoS, Type, Reading — vazio vira placeholder tracejado.
 */
export function MetaEdicao({ obra }: { obra: Obra }) {
  const salvar = useSalvarCampos();
  const [modal, setModal] = useState<CampoModal | null>(null);

  // Três valores só: ciclar no clique sai mais barato que abrir um modal.
  function ciclarClassificacao() {
    const proxima: Classificacao | null =
      obra.classificacao === 'R-15' ? 'R-18' : obra.classificacao === 'R-18' ? null : 'R-15';
    void salvar(obra, { classificacao: proxima });
  }

  function selecionarPublicacao(valor: string | null) {
    // Edição manual trava contra sobrescrita do scraper, mesmo critério do
    // autosave da tela da obra. Fora do Hiatus, "End of Season" é inválido.
    const patch: Partial<NovaObra> = {
      status_publicacao: valor as StatusPublicacao | null,
      status_publicacao_manual: true,
    };
    if (valor !== 'Hiatus') patch.fim_de_temporada = false;
    void salvar(obra, patch);
    setModal(null);
  }

  return (
    <>
      <CampoBadge
        valor={obra.classificacao}
        rotulo="Age"
        classe={obra.classificacao === 'R-18' ? 'badge-classificacao badge-r18' : 'badge-classificacao badge-r15'}
        onClick={ciclarClassificacao}
      />
      <CampoBadge
        valor={obra.status_publicacao}
        rotulo="Publication"
        classe="badge-pub"
        onClick={() => setModal('publicacao')}
      />
      {/* EoS só existe sob Hiatus; fora dele o campo é inválido. */}
      {obra.status_publicacao === 'Hiatus' && (
        <CampoBadge
          valor={obra.fim_de_temporada ? 'End of Season' : null}
          rotulo="EoS"
          classe="badge-eos"
          onClick={() => void salvar(obra, { fim_de_temporada: !obra.fim_de_temporada })}
        />
      )}
      <CampoBadge valor={obra.tipo} rotulo="Type" onClick={() => setModal('tipo')} />
      <CampoBadge
        valor={obra.status_leitura}
        rotulo="Reading"
        classe="badge-status"
        onClick={() => setModal('leitura')}
      />

      {modal === 'tipo' && (
        <ModalSelecao
          obraId={obra.id}
          rotulo="Type"
          categoria="tipo"
          valorAtual={obra.tipo}
          onFechar={() => setModal(null)}
          onSelecionar={(v) => {
            void salvar(obra, { tipo: v as Tipo | null });
            setModal(null);
          }}
        />
      )}
      {modal === 'leitura' && (
        <ModalSelecao
          obraId={obra.id}
          rotulo="Reading status"
          categoria="status_leitura"
          valorAtual={obra.status_leitura}
          onFechar={() => setModal(null)}
          onSelecionar={(v) => {
            void salvar(obra, { status_leitura: v as StatusLeitura | null });
            setModal(null);
          }}
        />
      )}
      {modal === 'publicacao' && (
        <ModalSelecao
          obraId={obra.id}
          rotulo="Publication status"
          categoria="status_publicacao"
          valorAtual={obra.status_publicacao}
          onFechar={() => setModal(null)}
          onSelecionar={selecionarPublicacao}
        />
      )}
    </>
  );
}

// --- Estrelas ---------------------------------------------------------------

const ESTRELAS = [1, 2, 3, 4, 5];

/** Cinco estrelas sempre visíveis (as vazias como ☆), todas clicáveis. Clicar
 * na estrela que já é a nota limpa — é a única saída pra desfazer. */
export function EstrelasEditaveis({ obra }: { obra: Obra }) {
  const salvar = useSalvarCampos();
  const atual = obra.score ?? 0;

  return (
    <div className="estrelas estrelas-editaveis" role="radiogroup" aria-label="Rating">
      {ESTRELAS.map((n) => {
        const marcada = obra.score === n;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={marcada}
            aria-label={`Rate ${n} of 5`}
            title={marcada ? 'Clear rating' : `Rate ${n} of 5`}
            className="estrela-botao"
            onClick={() => void salvar(obra, { score: marcada ? null : n })}
          >
            {n <= atual ? '★' : '☆'}
          </button>
        );
      })}
    </div>
  );
}

// --- Sources ----------------------------------------------------------------

function ModalSources({ obra, onFechar }: { obra: Obra; onFechar: () => void }) {
  useFixarObraEnquantoAberto(obra.id);
  const { mostrarToast } = useToast();
  const { confirmar } = useDialogos();
  const sitesAtivos = useSitesAtivos();
  // Live: cada fonte adicionada aparece sozinha, sem recarregar o modal.
  const fontes = useLiveQuery(() => db.fontes.where('obra_id').equals(obra.id).toArray(), [obra.id]) ?? [];

  const [url, setUrl] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [adicionando, setAdicionando] = useState(false);

  async function handleAdicionar(e: FormEvent) {
    e.preventDefault();
    if (adicionando) return;
    const limpo = url.trim();
    if (!limpo) {
      setErro('Paste a URL first.');
      return;
    }
    if (!dominioDeUrl(limpo)) {
      setErro("That doesn't look like a valid URL.");
      return;
    }
    if (fontes.some((f) => urlNormalizada(f.url) === urlNormalizada(limpo))) {
      setErro('This work already has that source.');
      return;
    }

    setAdicionando(true);
    try {
      await adicionarFonteNaObra(obra.id, limpo, obra.tipo, fontes);
      // Campo esvaziado fica pronto pra próxima, sem empilhar campos vazios.
      setUrl('');
      setErro(null);
      mostrarToast('Saved ✓');
    } catch (err) {
      mostrarToast(mensagemDeErro(err), 'erro');
    } finally {
      setAdicionando(false);
    }
  }

  async function handleExcluir(fonte: Fonte) {
    const nome = fonte.site || dominioDeUrl(fonte.url) || fonte.url;
    const ok = await confirmar({
      titulo: 'Delete source',
      mensagem: `Delete the source "${nome}" from "${obra.titulo}"?`,
      confirmarRotulo: 'Delete',
      perigoso: true,
    });
    if (!ok) return;
    try {
      await deleteFonte(fonte.id);
      mostrarToast('Source deleted');
    } catch (err) {
      mostrarToast(mensagemDeErro(err), 'erro');
    }
  }

  return (
    <ModalBase aberto rotulo="Sources" onFechar={onFechar} classe="modal-edicao">
      <h3 className="modal-titulo">Sources</h3>

      <ul className="modal-fontes">
        {fontes.map((f) => {
          const nome = f.site || dominioDeUrl(f.url) || f.url;
          const naoMonitorada = !sitesAtivos.has(nome.toLowerCase());
          return (
            <li key={f.id}>
              <span className="modal-fontes-texto">
                {nome}
                {naoMonitorada && (
                  <span className="badge-nao-monitorada" title="Domain not approved for scraping">
                    unmonitored
                  </span>
                )}
                {f.ultimo_capitulo_detectado != null && <span> · ch. {f.ultimo_capitulo_detectado}</span>}
              </span>
              <button
                type="button"
                className="btn-icone btn-icone-perigo"
                onClick={() => handleExcluir(f)}
                aria-label={`Delete source ${nome}`}
                title="Delete source"
              >
                ×
              </button>
            </li>
          );
        })}
        {fontes.length === 0 && <li className="modal-fontes-vazio">No sources yet.</li>}
      </ul>

      <form className="modal-fonte-nova" onSubmit={handleAdicionar}>
        <input
          type="url"
          value={url}
          placeholder="https://…"
          onChange={(e) => {
            setUrl(e.target.value);
            if (erro) setErro(null);
          }}
          data-autofocus
        />
        <button type="submit" disabled={adicionando} aria-label="Add source" title="Add source">
          +
        </button>
      </form>
      {erro && <p className="modal-aviso modal-aviso-bloqueio">{erro}</p>}

      {/* Cada fonte já grava na hora (toast "Saved ✓" por ação); este botão só
          fecha o modal. Existe pra ser o gatilho explícito de "terminei" — até
          aqui a obra fica fixada na lista (useFixarObraEnquantoAberto), então
          o card não some no meio da edição mesmo que ela deixe de bater um
          filtro ativo (ex.: sair de "Unsourced" ao ganhar a primeira fonte). */}
      <div className="modal-acoes">
        <button type="button" onClick={onFechar}>
          Save
        </button>
      </div>
    </ModalBase>
  );
}

/** Entrada pro modal de sources: fica abaixo da lista de fontes do card. */
export function BotaoAdicionarSource({ obra }: { obra: Obra }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button type="button" className="chip-vazio obra-card-add-source" onClick={() => setAberto(true)}>
        + source
      </button>
      {aberto && <ModalSources obra={obra} onFechar={() => setAberto(false)} />}
    </>
  );
}
