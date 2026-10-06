import { useMemo } from 'react';
import { useBackupStatus } from '../hooks/useBackupStatus';
import { backupAtrasado, formatarBytes, gravaMensal, limpaImagens, proximoBackup } from '../lib/backup';
import type { BackupSnapshot } from '../types';

const DATA_HORA: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

function formatarDataHora(d: Date): string {
  return d.toLocaleString('en-US', DATA_HORA);
}

function ListaSnapshots({ titulo, itens }: { titulo: string; itens: BackupSnapshot[] }) {
  return (
    <section className="atualizacao-secao">
      <h3>{titulo}</h3>
      {itens.length === 0 ? (
        <p className="backup-vazio">None yet.</p>
      ) : (
        <ul className="backup-lista">
          {itens.map((b) => (
            <li key={`${b.tipo}-${b.nome}`} className="backup-item">
              <span className="backup-item-nome">{b.nome}</span>
              <span className="backup-item-info">
                {formatarBytes(b.tamanho_bytes)}
                {b.linhas !== null && ` · ${b.linhas.toLocaleString('en-US')} rows`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Settings > Backup: o que existe hoje no R2 (só os backups atuais, os já
 * apagados pela retenção não aparecem), quando é o próximo e o tamanho do
 * bucket. Os dados vêm de backup_status, que o workflow de backup atualiza ao
 * terminar — então o tamanho reflete o fim do último backup, não o instante.
 */
export function BackupPage() {
  const { status, carregando, erro, recarregar } = useBackupStatus();
  const proximo = useMemo(() => proximoBackup(new Date()), []);
  const atrasado = status !== null && backupAtrasado(status.atualizado_em, new Date());

  const semanais = status?.snapshots.filter((b) => b.tipo === 'weekly') ?? [];
  const mensais = status?.snapshots.filter((b) => b.tipo === 'monthly') ?? [];

  return (
    <div className="sources-pagina">
      <div className="sources-topo">
        <h1>Backup</h1>
        <p className="sources-subtitulo">Weekly copies of the database and images, stored in Cloudflare R2.</p>
      </div>

      <section className="atualizacao-secao">
        <h3>Next backup</h3>
        <p>
          <strong>{formatarDataHora(proximo)}</strong>
        </p>
        <p className="backup-nota">
          Runs every Sunday. GitHub may start it a few minutes late.
          {gravaMensal(proximo) && ' This one also saves the monthly copy.'}
          {limpaImagens(proximo) && ' It also removes images from the backup that no longer exist in the app.'}
        </p>
      </section>

      {carregando && <p>Loading…</p>}
      {erro !== null && (
        <p className="backup-erro">
          Could not load backup info: {erro}{' '}
          <button type="button" onClick={() => void recarregar()}>
            Retry
          </button>
        </p>
      )}

      {!carregando && erro === null && status === null && (
        <p className="backup-vazio">
          No backup recorded yet. Run it from GitHub (Actions, Backup, Run workflow) or wait for the next Sunday.
        </p>
      )}

      {status !== null && (
        <>
          <section className="atualizacao-secao">
            <h3>Last backup</h3>
            <p>
              <strong>{formatarDataHora(new Date(status.atualizado_em))}</strong>
            </p>
            {atrasado && (
              <p className="backup-erro">
                More than a week without a new backup. Check the Backup workflow on GitHub Actions.
              </p>
            )}
          </section>

          <section className="atualizacao-secao">
            <h3>Bucket size</h3>
            <p>
              <strong>{formatarBytes(status.tamanho_total_bytes)}</strong>
            </p>
            <p className="backup-nota">
              Database copies: {formatarBytes(status.tamanho_db_bytes)}. Images and files:{' '}
              {formatarBytes(status.tamanho_imagens_bytes)} ({status.objetos_imagens.toLocaleString('en-US')} files).
              Updated at the end of each backup.
            </p>
          </section>

          <ListaSnapshots titulo="Weekly backups" itens={semanais} />
          <ListaSnapshots titulo="Monthly backups" itens={mensais} />
        </>
      )}
    </div>
  );
}
