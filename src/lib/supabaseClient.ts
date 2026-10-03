import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY não configuradas. Copie .env.example para .env.local e preencha.'
  );
}

// Chamadas de dados/auth ganham um teto de tempo: um fetch que nunca responde
// travava o ciclo de sync (e o botão em "Syncing…") indefinidamente. Uploads do
// Storage ficam de fora, pois podem demorar mais em conexões lentas.
const TEMPO_MAXIMO_REQUISICAO_MS = 30_000;

function fetchComLimite(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const alvo = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!alvo.includes('/rest/v1/') && !alvo.includes('/auth/v1/')) return fetch(input, init);
  const limite = AbortSignal.timeout(TEMPO_MAXIMO_REQUISICAO_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, limite]) : limite;
  return fetch(input, { ...init, signal });
}

export const supabase = createClient(url, anonKey, { global: { fetch: fetchComLimite } });
