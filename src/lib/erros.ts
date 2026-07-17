/** Extrai uma mensagem legível de qualquer formato de erro (Error, PostgrestError, FunctionsHttpError, objeto plano, string). */
export function mensagemDeErro(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    for (const chave of ['message', 'error_description', 'error', 'details', 'hint']) {
      const v = o[chave];
      if (typeof v === 'string' && v.trim()) return v;
    }
    try {
      return JSON.stringify(err);
    } catch {
      /* segue pro fallback */
    }
  }
  return String(err);
}

/** Mensagem de erro para ações que dependem da Edge Function scraper-control. */
export function mensagemErroAcao(err: unknown): string {
  const detalhe = mensagemDeErro(err);
  return `Could not reach the scraper control (${detalhe}). Check that the "scraper-control" Edge Function is deployed and that the GH_ACTIONS_TOKEN secret is set.`;
}
