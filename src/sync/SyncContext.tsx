import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { syncNow } from './sync';

interface SyncState {
  online: boolean;
  syncing: boolean;
  lastError: unknown;
  lastSyncAt: Date | null;
  syncAgora: () => void;
}

const SyncContext = createContext<SyncState | null>(null);

const SYNC_INTERVAL_MS = 5 * 60 * 1000;

export function SyncProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [lastError, setLastError] = useState<unknown>(null);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);

  const runSync = useCallback(() => {
    setSyncing(true);
    syncNow()
      .then((result) => {
        if (result.ok) {
          setLastSyncAt(new Date());
          setLastError(null);
        } else if (result.error !== 'offline' && result.error !== 'already-syncing') {
          setLastError(result.error);
        }
      })
      .finally(() => setSyncing(false));
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      runSync();
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    runSync();
    const interval = setInterval(runSync, SYNC_INTERVAL_MS);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [runSync]);

  return (
    <SyncContext.Provider value={{ online, syncing, lastError, lastSyncAt, syncAgora: runSync }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync(): SyncState {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync precisa estar dentro de <SyncProvider>');
  return ctx;
}
