import { readFile, writeFile, mkdir, open, unlink, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CdpConnection } from '../packages/runtime/cdp.mjs';
import { startRuntimeService } from '../packages/runtime/service.mjs';
import { parseAttachPid, discoverPort } from '../packages/runtime/discovery.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const stateDirectory = path.join(root, 'data/runtime');
const lockFile = path.join(stateDirectory, 'session.lock');
const logFile = path.join(stateDirectory, 'launcher.log');
const execFileAsync = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let cdp, service, ownsLock = false, stopped = false, hostTimer;
await mkdir(stateDirectory, { recursive: true });
const log = message => {
  console.log(message);
  void import('node:fs/promises').then(fs => fs.appendFile(logFile, `${new Date().toISOString()} ${message}\n`, 'utf8')).catch(() => {});
};
const ps7 = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft/PowerShell/7/pwsh.exe');
const powershell = await access(ps7).then(() => ps7, () => 'powershell.exe');
const psLiteral = value => "'" + value.replaceAll("'", "''") + "'";
async function runtimeProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  const script = String.raw`$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid} AND Name='node.exe'";if($p -and $p.CommandLine -and $p.CommandLine.Replace('/','\').Contains(${psLiteral(path.join(root, 'scripts/launch-runtime.mjs'))})){'true'}`;
  const result = await execFileAsync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8' });
  return result.stdout.trim() === 'true';
}
async function hostInfo(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  const script = String.raw`$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}";if($p){$port=$null;$folder=$null;$w=Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object {$_.ParentProcessId -eq $p.ProcessId};foreach($v in $w){if($v.CommandLine -match '--remote-debugging-port=([0-9]+)'){$port=[int]$Matches[1];if($v.CommandLine -match '--user-data-dir=(?:"([^"]+)"|([^\s]+))'){$folder=if($Matches[1]){$Matches[1]}else{$Matches[2]}};break}};[pscustomobject]@{pid=$p.ProcessId;target=$p.ExecutablePath;port=$port;userDataFolder=$folder;startedAt=([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds()}|ConvertTo-Json -Compress}`;
  const result = await execFileAsync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8' });
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}
async function pageTarget(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
  if (!response.ok) return null;
  return (await response.json()).find(item => item.type === 'page' && item.url.startsWith('http://tauri.localhost/'));
}
async function stop() {
  if (stopped) return;
  stopped = true; clearInterval(hostTimer);
  await service?.dispose(); cdp?.close();
  if (ownsLock) {
    const lock = await readFile(lockFile, 'utf8').then(JSON.parse).catch(() => null);
    if (lock?.nodePid === process.pid) await unlink(lockFile).catch(() => {});
  }
}
try {
  const hostPid = parseAttachPid(process.argv.slice(2));
  let current = await hostInfo(hostPid);
  if (!current) process.exit(0);
  const target = current.target;
  await access(target); await access(path.join(root, 'dist/runtime-page.js')); await access(path.join(root, 'dist/runtime-frame.js'));
  for (let attempt = 0; ; attempt++) {
    try {
      const file = await open(lockFile, 'wx');
      await file.writeFile(JSON.stringify({ nodePid: process.pid, hostPid, target }) + '\n', 'utf8'); await file.close(); ownsLock = true; break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const previous = await readFile(lockFile, 'utf8').then(JSON.parse).catch(() => null);
      if (!previous && attempt < 20) { await sleep(100); continue; }
      if (previous && await runtimeProcessAlive(previous.nodePid)) {
        if (previous.hostPid === hostPid || await hostInfo(previous.hostPid)) { log('当前客户端已由运行层助手接入'); process.exit(0); }
        if (attempt >= 30) throw new Error('前一客户端的运行层正在退出，请稍后重新打开客户端');
        await sleep(100); continue;
      }
      await unlink(lockFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  const beforeHash = createHash('sha256').update(await readFile(target)).digest('hex');
  hostTimer = setInterval(() => { try { process.kill(hostPid, 0); } catch { void stop(); } }, 1000);
  let page, port;
  for (let attempt = 0; attempt < 100; attempt++) {
    current = await hostInfo(hostPid);
    if (!current) { await stop(); process.exit(0); }
    port = await discoverPort(current);
    page = port && await pageTarget(port).catch(() => null);
    if (page) break;
    if (attempt === 99) throw new Error('客户端连接尚未就绪，请检查 DLL 配置和运行层日志');
    await sleep(300);
  }
  await writeFile(lockFile, JSON.stringify({ nodePid: process.pid, hostPid, target, port }) + '\n', 'utf8');
  cdp = await CdpConnection.connect(page.webSocketDebuggerUrl);
  cdp.on('close', () => { void stop(); });
  process.on('SIGINT', () => { void stop(); }); process.on('SIGTERM', () => { void stop(); });
  service = await startRuntimeService(cdp, { log });
  const afterHash = createHash('sha256').update(await readFile(target)).digest('hex');
  if (beforeHash !== afterHash) throw new Error('客户端文件在接入期间发生变化，请重新检查版本');
  log(`DLL 自动接入完成，宿主 PID=${hostPid}；客户端运行期间校验保持一致：${afterHash}`);
} catch (error) {
  log(`启动失败：${error.message}`); await stop(); process.exitCode = 1;
}
