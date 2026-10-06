/**
 * Regras da aba Settings > Backup. O agendamento mora em
 * .github/workflows/backup.yml (cron `0 6 * * 0` = domingo 06:00 UTC); estas
 * constantes precisam ficar em sincronia com ele.
 */

const HORA_BACKUP_UTC = 6;
const DOMINGO = 0;
/** Mais que isso sem backup novo (semanal + folga) indica que o workflow está falhando. */
const LIMITE_ATRASO_DIAS = 8;
const DIA_MS = 24 * 60 * 60 * 1000;

const UNIDADES = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatarBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNIDADES.length - 1);
  const valor = bytes / 1024 ** i;
  return `${i === 0 ? valor : valor.toFixed(valor >= 100 ? 0 : 1)} ${UNIDADES[i]}`;
}

/** Próximo domingo 06:00 UTC estritamente depois de `agora`. */
export function proximoBackup(agora: Date): Date {
  const candidato = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), HORA_BACKUP_UTC));
  while (candidato.getUTCDay() !== DOMINGO || candidato.getTime() <= agora.getTime()) {
    candidato.setUTCDate(candidato.getUTCDate() + 1);
  }
  return candidato;
}

/** Primeiro domingo do mês (dia <= 7): além do semanal, grava o mensal. */
export function gravaMensal(dataBackup: Date): boolean {
  return dataBackup.getUTCDate() <= 7;
}

/** Janeiro/julho, primeiro domingo: remove do R2 as imagens que já saíram do Supabase. */
export function limpaImagens(dataBackup: Date): boolean {
  const mes = dataBackup.getUTCMonth();
  return (mes === 0 || mes === 6) && dataBackup.getUTCDate() <= 7;
}

export function backupAtrasado(atualizadoEm: string, agora: Date): boolean {
  return agora.getTime() - new Date(atualizadoEm).getTime() > LIMITE_ATRASO_DIAS * DIA_MS;
}
