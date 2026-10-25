import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
git('diff', '--exit-code', 'HEAD', '--');
const files = git('ls-tree', '-rz', '--name-only', 'HEAD').split('\0').filter(Boolean);
const excluded = /(^|\/)(?:tests?|__tests__|fixtures|verification|data|cache|reports|evidence|references|node_modules|dist)(?:\/|$)|\.test\./i;
assert(files.length > 0 && !files.some(file => excluded.test(file)), 'Git 文件清单含本地资料或产物，请先修正提交范围');
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
assert(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(metadata.version), '版本号格式无效');
const plugin = await readFile(path.join(root, 'packages/plugin/st-compatibility.js'), 'utf8');
assert.equal(plugin.match(/^\/\/@version\s+(\S+)/m)?.[1], metadata.version, '插件版本与项目版本不一致');
if (process.env.GITHUB_REF_TYPE === 'tag') assert.equal(process.env.GITHUB_REF_NAME, `v${metadata.version}`, '标签与项目版本不一致');

const prefix = 'RisuAI-ST-Compatibility/';
const mtime = new Date(Number(git('show', '-s', '--format=%ct', 'HEAD')) * 1000);
const entries = Object.fromEntries(await Promise.all(files.map(async file => [prefix + file,
  [new Uint8Array(await readFile(path.join(root, file))), { mtime }]])));
const dllPath = 'packages/loader/dist/RisuRuntimeLoader.dll';
const dll = await readFile(path.join(root, dllPath));
assert.equal(dll.subarray(0, 2).toString(), 'MZ', '加载器不是 PE 文件');
const pe = dll.readUInt32LE(0x3c);
assert.equal(dll.readUInt32LE(pe), 0x4550, '加载器 PE 签名无效');
assert.equal(dll.readUInt16LE(pe + 4), 0x8664, '加载器必须为 Windows x64');
assert(dll.readUInt16LE(pe + 22) & 0x2000, '加载器必须为 DLL');
entries[prefix + dllPath] = [new Uint8Array(dll), { mtime }];
const archive = zipSync(entries, { level: 9 });
const unpacked = unzipSync(archive);
assert.equal(Object.keys(unpacked).length, files.length + 1, '归档文件数量不符');
for (const [name, [bytes]] of Object.entries(entries)) assert.deepEqual(unpacked[name], bytes, `归档校验失败：${name}`);

const directory = path.join(root, 'dist/release');
const name = `RisuAI-ST-Compatibility-v${metadata.version}-windows-x64.zip`;
await mkdir(directory, { recursive: true });
await writeFile(path.join(directory, name), archive);
await writeFile(path.join(directory, 'SHA256SUMS.txt'), `${createHash('sha256').update(archive).digest('hex')}  ${name}\n`, 'utf8');
console.log(`已生成 ${name}（${files.length} 个源码文件及加载器 DLL），归档逐文件校验通过。`);
