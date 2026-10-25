import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export function parseAttachPid(args) {
  if (args.length !== 2 || args[0] !== '--attach-pid' || !/^[1-9][0-9]*$/.test(args[1]) || !Number.isSafeInteger(Number(args[1]))) {
    throw new Error('请直接启动已安装运行层 DLL 的 RisuAI.exe；手动接入使用 --attach-pid <客户端 PID>');
  }
  return Number(args[1]);
}

export async function discoverPort({ port, userDataFolder, startedAt }) {
  if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
  if (port !== 0 || !userDataFolder) return null;
  const file = path.join(userDataFolder, 'DevToolsActivePort');
  try {
    const info = await stat(file);
    if (info.mtimeMs < startedAt) return null;
    const [line, endpoint] = (await readFile(file, 'utf8')).trim().split(/\r?\n/);
    if (!/^[0-9]+$/.test(line) || !endpoint?.startsWith('/devtools/browser/')) return null;
    const actual = Number(line);
    return actual > 0 && actual <= 65535 ? actual : null;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
