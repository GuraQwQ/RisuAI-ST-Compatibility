import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { installRuntimeLoader } from '../packages/runtime/install.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--target' || !args[1]) throw new Error('请使用 --target <RisuAI.exe 路径> 指定安装目标');
const target = path.resolve(args[1]);
const result = spawnSync(process.execPath, ['scripts/build-runtime.mjs'], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
const installed = await installRuntimeLoader({ root, target, node: process.execPath });
console.log(`DLL 入口已安装：${installed.target}\n直接启动该 EXE 即可；代码和资源保留，已增加运行层 DLL 导入。`);
