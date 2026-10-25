import { fingerprint } from './history.mjs';

/** 每步写入可重复；安装记录保存待发布对象，崩溃后复用同一身份。 */
export async function installCardMigration({ source, storage, list, create, publish, activate }) {
  const prefix = `st-compat/migration/${source.hash}`;
  const existing = list().find(character => character.stCompatibility?.hash === source.hash);
  if (existing) { await activate(existing.chaId); return { id: existing.chaId, reused: true }; }
  let journal = await storage.get(prefix);
  if (!journal || journal.phase === 'rolled-back') {
    const character = await create();
    journal = { phase: 'prepared', sourceHash: source.hash, character,
      installedRevision: await fingerprint(character), previous: null };
    await storage.set(prefix, journal);
  }
  await publish(structuredClone(journal.character));
  const installed = list().find(character => character.chaId === journal.character.chaId);
  if (!installed || await fingerprint(installed) !== journal.installedRevision) throw new Error('导入对象未通过回读校验，记录已保存，可重试');
  await storage.set(prefix, { ...journal, phase: 'installed' });
  await activate(installed.chaId);
  return { id: installed.chaId, reused: false };
}

export async function rollbackCardMigration(hash, { storage, list, remove }) {
  const key = `st-compat/migration/${hash}`;
  const journal = await storage.get(key);
  if (!journal || journal.phase === 'rolled-back') return { status: 'absent' };
  const current = list().find(character => character.chaId === journal.character.chaId);
  if (current && await fingerprint(current) !== journal.installedRevision) return { status: 'modified', id: current.chaId };
  if (current) await remove(current.chaId);
  await storage.set(key, { ...journal, phase: 'rolled-back' });
  return { status: 'rolled-back' };
}
