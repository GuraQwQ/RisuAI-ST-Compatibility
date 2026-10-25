import { rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
for (const name of ['cache', 'scripts/__pycache__', 'packages/loader/build', 'packages/loader/__pycache__', 'packages/loader/tests/__pycache__']) {
  const target = path.resolve(root, name);
  const resolved = await realpath(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (!resolved) continue;
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('清理路径不属于本项目');
  await rm(target, { recursive: true, force: true });
}
console.log('已清除项目缓存，原卡、运行数据和备份保留');
