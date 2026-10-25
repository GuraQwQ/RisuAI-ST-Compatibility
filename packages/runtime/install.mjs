import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function installRuntimeLoader({ root, target, node }) {
  const installer = fileURLToPath(new URL('../loader/installer.py', import.meta.url));
  const script = path.join(root, 'scripts/launch-runtime.mjs');
  await readFile(script);
  const installed = spawnSync('python', [installer, 'install', '--target', target, '--program', node,
    '--arguments', '"' + script + '"'], { encoding: 'utf8', windowsHide: true });
  if (installed.status !== 0) throw new Error(installed.error?.message ?? installed.stderr ?? 'DLL 安装失败');
  const result = JSON.parse(installed.stdout);
  const directory = path.join(root, 'data/runtime');
  await mkdir(directory, { recursive: true });
  const record = path.join(directory, 'install.json');
  await writeFile(record + '.writing', JSON.stringify({ ...result, entry: 'dll' }, null, 2) + '\n', 'utf8');
  await rename(record + '.writing', record);
  return result;
}
