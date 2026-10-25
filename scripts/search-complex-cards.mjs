import { candidateCardPaths, inspectCardFile, meetsCardCriteria, readCandidateBytes } from '../packages/core/community-card-search.mjs';
import { githubBlobApiUrl, githubDirectoryItems, githubEmbeddedPayload, githubRepositoryTree, githubSearchResults } from '../packages/core/github-page-fallback.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const args = process.argv.slice(2);
const options = { minWorldEntries: 0, minRegexScripts: 0, requiresExternalScript: false };
const terms = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--min-world-entries') options.minWorldEntries = Number(args[++i]);
  else if (args[i] === '--min-regex-scripts') options.minRegexScripts = Number(args[++i]);
  else if (args[i] === '--requires-external-script') options.requiresExternalScript = true;
  else terms.push(args[i]);
}
for (const key of ['minWorldEntries', 'minRegexScripts']) {
  if (!Number.isInteger(options[key]) || options[key] < 0) throw new Error(`筛选参数 ${key} 必须是非负整数`);
}
const query = terms.join(' ') || 'SillyTavern character card';
const headers = { accept: 'application/vnd.github+json', 'user-agent': 'RisuAI-ST-Compatibility' };
const searchSignal = AbortSignal.timeout(60_000);
const requestSignal = () => AbortSignal.any([searchSignal, AbortSignal.timeout(6_000)]);
const execFileAsync = promisify(execFile);
async function curlBytes(url, userAgent, limit = 20_000_000) {
  const { stdout } = await execFileAsync(process.platform === 'win32' ? 'curl.exe' : 'curl', [
    '--silent', '--show-error', '--location', '--max-time', '6', '--max-filesize', String(limit),
    '--user-agent', userAgent, '--write-out', '%{http_code}', url,
  ], { encoding: 'buffer', maxBuffer: limit + 4, signal: searchSignal });
  const status = stdout.subarray(-3).toString('ascii');
  const bytes = stdout.subarray(0, -3);
  if (!/^2\d\d$/.test(status)) throw new Error(`GitHub 请求失败：HTTP ${status}`);
  if (bytes.byteLength > limit) throw new Error(`GitHub 响应超过 ${limit} 字节限制`);
  return bytes;
}
async function github(url) {
  let networkError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { headers, signal: requestSignal() });
      if (response.ok) return response.json();
      if (response.status < 500 && response.status !== 429) throw new Error(`GitHub 请求失败：HTTP ${response.status}`);
      if (attempt === 1) throw new Error(`GitHub 请求失败：HTTP ${response.status}`);
    } catch (error) {
      if (/HTTP \d+/.test(error.message)) throw error;
      networkError = error;
    }
  }
  try { return JSON.parse((await curlBytes(url, headers['user-agent'])).toString('utf8')); }
  catch { throw networkError; }
}
async function githubPage(url) {
  let networkError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: requestSignal() });
      if (response.ok) return response.text();
      if (response.status < 500 && response.status !== 429) throw new Error(`GitHub 页面请求失败：HTTP ${response.status}`);
      if (attempt === 1) throw new Error(`GitHub 页面请求失败：HTTP ${response.status}`);
    } catch (error) {
      if (/HTTP \d+/.test(error.message)) throw error;
      networkError = error;
    }
  }
  try { return (await curlBytes(url, 'Mozilla/5.0')).toString('utf8'); }
  catch { throw networkError; }
}
async function searchRepositories(query) {
  const url = new URL('https://api.github.com/search/repositories');
  url.search = new URLSearchParams({ q: query, sort: 'updated', order: 'desc', per_page: '20' });
  try {
    const { items } = await github(url);
    return { items, source: 'GitHub Search API', errors: [] };
  } catch (error) {
    const page = await githubPage(`https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`);
    const items = githubSearchResults(githubEmbeddedPayload(page));
    if (!items) throw new Error(`GitHub API 与网页搜索均失败：${error.message}`);
    return { items, source: 'GitHub repository search page', errors: [{ phase: 'search-api', message: error.message }] };
  }
}
async function repositoryTree(repository) {
  try { return await github(`https://api.github.com/repos/${repository.full_name}/git/trees/${encodeURIComponent(repository.default_branch)}?recursive=1`); }
  catch (error) {
    const page = await githubPage(`https://github.com/${repository.full_name}`);
    const root = githubRepositoryTree(githubEmbeddedPayload(page), repository.default_branch);
    const branch = root?.branch;
    const rootItems = root?.items;
    if (!rootItems) throw new Error(`仓库树 API 与仓库页面均不可读：${error.message}`);
    const files = [];
    const directories = [];
    const addFiles = entries => {
      for (const item of entries ?? []) {
        if (item.contentType === 'directory') directories.push(item.path);
        else if (item.contentType === 'file') files.push({
          path: item.path, type: 'blob', size: null,
          url: `https://github.com/${repository.full_name}/blob/${branch}/${item.path.split('/').map(encodeURIComponent).join('/')}`,
        });
      }
    };
    addFiles(rootItems);
    let directoryCount = 0;
    while (directories.length && files.length < 120 && directoryCount < 40 && !searchSignal.aborted) {
      const directory = directories.shift();
      directoryCount++;
      const dirPage = await githubPage(`https://github.com/${repository.full_name}/tree/${encodeURIComponent(branch)}/${directory.split('/').map(encodeURIComponent).join('/')}`);
      addFiles(githubDirectoryItems(githubEmbeddedPayload(dirPage), directory));
    }
    if (!files.length) throw new Error(`仓库树 API 与目录页面均未发现卡片文件：${error.message}`);
    return { tree: files, truncated: directories.length > 0 || files.length >= 120, fallback: 'GitHub repository HTML', defaultBranch: branch };
  }
}
async function rawFile(url, blobUrl) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': headers['user-agent'] }, signal: requestSignal() });
      const bytes = await readCandidateBytes(response);
      if (bytes) return bytes;
    } catch (error) { if (attempt === 1) break; }
  }
  try {
    const bytes = await curlBytes(url, headers['user-agent']);
    if (bytes.byteLength) return bytes;
  } catch {}
  try {
    const blob = await github(blobUrl);
    return blob.encoding === 'base64' ? Uint8Array.from(Buffer.from(blob.content, 'base64')) : null;
  } catch { return null; }
}
const githubPath = (repository, branch, file) =>
  `https://github.com/${repository}/blob/${encodeURIComponent(branch)}/${file.split('/').map(encodeURIComponent).join('/')}`;
const search = await searchRepositories(query);
const { items } = search;
const errors = [];
const candidates = [];
const repositories = items.slice(0, 6);
for (let offset = 0; offset < repositories.length; offset += 4) {
  await Promise.all(repositories.slice(offset, offset + 4).map(async repository => {
  try {
    const tree = await repositoryTree(repository);
    const allCardFiles = candidateCardPaths(tree.tree);
    const branch = tree.defaultBranch ?? repository.default_branch;
    const cardFiles = allCardFiles.slice(0, 6);
    const cards = (await Promise.all(cardFiles.map(async file => {
      const rawUrl = githubBlobApiUrl(file.url)
        ? `https://raw.githubusercontent.com/${repository.full_name}/${branch}/${file.path.split('/').map(encodeURIComponent).join('/')}`
        : file.url.replace('/blob/', '/raw/');
      const bytes = await rawFile(rawUrl, file.url);
      return bytes ? inspectCardFile(file.path, bytes) : null;
    }))).flatMap(cards => cards ?? []).filter(card => meetsCardCriteria(card, options));
    if (searchSignal.aborted) errors.push({ repository: repository.full_name, message: '搜索达到 60 秒时限，仅返回已完成检查的候选' });
    if (cards.length) candidates.push({
      repository: repository.full_name, stars: repository.stargazers_count, updated: repository.pushed_at,
      repositoryLicense: repository.license?.spdx_id ?? null, description: repository.description, url: repository.html_url,
      defaultBranch: branch, cards: cards.slice(0, 10).map(card => ({ ...card, url: githubPath(repository.full_name, branch, card.path) })),
      inspectedFiles: cardFiles.length,
      licenseFiles: tree.tree.filter(file => file.type === 'blob' &&
        /(?:^|\/)(?:readme(?:\.[^/]*)?|license(?:\.[^/]*)?|copying(?:\.[^/]*)?)$/i.test(file.path))
        .slice(0, 20).map(file => ({ path: file.path, url: githubPath(repository.full_name, branch, file.path) })),
      repositoryTreeTruncated: tree.truncated, repositoryTreeSource: tree.fallback ?? 'GitHub Trees API',
      contentLicense: '需查阅仓库说明和卡片文件；仓库代码许可证不自动覆盖角色内容', criteria: options,
    });
  } catch (error) { errors.push({ repository: repository.full_name, message: error.message }); }
  }));
}
console.log(JSON.stringify({ query, criteria: options, source: search.source, repositoriesReturned: items.length, repositoriesInspected: repositories.length,
  found: candidates.length, candidates, errors: [...search.errors, ...errors] }, null, 2));
