import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * Edit mode da aba List: o card vira superfície editável, pra preencher lacunas
 * do acervo sem entrar em cada obra. O estado vive aqui (e não na lista) porque
 * o botão que liga o modo fica no header, fora da página.
 *
 * O estado NÃO persiste: cada visita à lista começa com o modo desligado. É
 * deliberado — o modo muda o significado dos cliques no card, e voltar a um app
 * que reage diferente sem aviso é pior do que religar com um clique.
 */
interface ModoEdicaoApi {
  /** Modo ligado. Só pode ser true quando disponivel é true. */
  modoEdicao: boolean;
  /** Alterna o modo. Ignorado quando indisponível. */
  alternarModo: () => void;
  /** Desliga o modo (usado ao sair da rota ou trocar pro grid). */
  sairDoModo: () => void;
  /** A tela atual suporta o modo (aba List na visualização List). */
  disponivel: boolean;
  /** Chamado pela ListaPrincipalPage pra declarar disponibilidade. */
  setDisponivel: (v: boolean) => void;
  /**
   * Id da obra com um modal de edição aberto no card, ou null. A lista filtrada
   * mantém essa obra visível mesmo que ela deixe de bater um filtro ativo (ex.:
   * ganhar uma fonte com "Unsourced" ligado) — sem isso o card some da tela no
   * meio da edição e desmonta o modal aberto junto.
   */
  obraFixada: string | null;
  fixarObra: (id: string) => void;
  /** Só desfixa se `id` ainda for a obra fixada (evita corrida entre modais). */
  desafixarObra: (id: string) => void;
  /** O botão do rato no header está visível na viewport agora (IntersectionObserver). */
  headerBotaoVisivel: boolean;
  setHeaderBotaoVisivel: (v: boolean) => void;
}

const ModoEdicaoContext = createContext<ModoEdicaoApi | null>(null);

export function ModoEdicaoProvider({ children }: { children: ReactNode }) {
  const [modoEdicao, setModoEdicao] = useState(false);
  // setDisponivel do useState já é estável, então pode ir direto pra API sem
  // useCallback — a lista usa essa função dentro de um efeito.
  const [disponivel, setDisponivel] = useState(false);
  const [obraFixada, setObraFixada] = useState<string | null>(null);
  const [headerBotaoVisivel, setHeaderBotaoVisivel] = useState(true);

  // Ficar indisponível desliga o modo. Cobre de uma vez os três casos: sair da
  // aba List, desmontar a lista e trocar pro Grid.
  useEffect(() => {
    if (!disponivel) setModoEdicao(false);
  }, [disponivel]);

  const alternarModo = useCallback(() => {
    if (!disponivel) return;
    setModoEdicao((v) => !v);
  }, [disponivel]);

  const sairDoModo = useCallback(() => setModoEdicao(false), []);

  const fixarObra = useCallback((id: string) => setObraFixada(id), []);
  const desafixarObra = useCallback((id: string) => {
    setObraFixada((atual) => (atual === id ? null : atual));
  }, []);

  const api = useMemo<ModoEdicaoApi>(
    () => ({
      modoEdicao,
      alternarModo,
      sairDoModo,
      disponivel,
      setDisponivel,
      obraFixada,
      fixarObra,
      desafixarObra,
      headerBotaoVisivel,
      setHeaderBotaoVisivel,
    }),
    [modoEdicao, alternarModo, sairDoModo, disponivel, obraFixada, fixarObra, desafixarObra, headerBotaoVisivel]
  );

  return <ModoEdicaoContext.Provider value={api}>{children}</ModoEdicaoContext.Provider>;
}

export function useModoEdicao(): ModoEdicaoApi {
  const ctx = useContext(ModoEdicaoContext);
  if (!ctx) throw new Error('useModoEdicao precisa estar dentro de <ModoEdicaoProvider>');
  return ctx;
}
