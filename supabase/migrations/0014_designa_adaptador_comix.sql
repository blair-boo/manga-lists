-- HANDOUT_SCRAPER_COMIX seção 7: designa o adaptador 'comix' aos domínios
-- comix.to/comix.ws.
--
-- Desvio da instrução literal do handout (que descrevia um INSERT com nome
-- curto 'comix'/'comix-ws'): as duas linhas já existiam em sites_suportados
-- (nome='comix.to' e nome='comix.ws', ambas sem adaptador designado —
-- provavelmente da fila de descoberta de domínios, antes deste handout ser
-- executado). `nome` é UNIQUE e todo domínio recente segue o hostname
-- completo como nome (padrão já usado por anubisscans.com, arenascan.com
-- etc.); inserir 'comix'/'comix-ws' criaria uma linha duplicada pro mesmo
-- url_base e quebraria o mapeamento por host em carregar_designacoes(). Em
-- vez disso, atualiza as linhas existentes.
--
-- comix.ws entra INATIVO (ativo=false): é o espelho reserva anunciado pelo
-- próprio site quando o domínio principal fica inacessível. Estava ativo=true
-- (herdado da descoberta automática); o handout pede inativo por padrão.

update sites_suportados
   set adaptador = 'comix',
       access_strategy = 'http'
 where nome = 'comix.to';

update sites_suportados
   set adaptador = 'comix',
       access_strategy = 'http',
       ativo = false
 where nome = 'comix.ws';
