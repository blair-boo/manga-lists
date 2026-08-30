// Shim de IndexedDB pros testes que tocam o Dexie (src/db/repo.test.ts).
//
// Precisa rodar ANTES de qualquer import de código: `src/db/localDb.ts` faz
// `new LocalDb()` no topo do módulo, e o Dexie procura `indexedDB` no globalThis
// já na construção. Por isso mora num setupFile, não dentro do teste.
import 'fake-indexeddb/auto';
