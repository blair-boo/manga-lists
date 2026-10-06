import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { BackupStatus } from '../types';

/** Lê o resumo do último backup (tabela backup_status, linha única). `status` nulo = nenhum backup registrado ainda. */
export function useBackupStatus() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    const { data, error } = await supabase.from('backup_status').select('*').eq('id', 1).maybeSingle();
    if (error) setErro(error.message);
    else setStatus((data as BackupStatus | null) ?? null);
    setCarregando(false);
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  return { status, carregando, erro, recarregar };
}
