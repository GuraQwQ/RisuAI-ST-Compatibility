export function githubEmbeddedPayload(html) {
  const marker = 'react-app.embeddedData';
  const index = html.indexOf(marker);
  const start = html.indexOf('>', index) + 1;
  const end = html.indexOf('</script>', start);
  if (index < 0 || start <= 0 || end < start) return null;
  try { return JSON.parse(html.slice(start, end)).payload; } catch { return null; }
}

export function githubSearchResults(payload) {
  return payload?.blackbirdSearchRoute?.results?.map(item => {
    const repository = item.repo.repository;
    const name = `${repository.owner_login}/${repository.name}`;
    return {
      full_name: name, default_branch: undefined, stars: item.followers,
      pushed_at: repository.updated_at, stargazers_count: item.followers,
      description: item.hl_trunc_description.replace(/<[^>]*>/g, ''),
      html_url: `https://github.com/${name}`, license: null,
    };
  }) ?? null;
}

export function githubRepositoryTree(payload, fallbackBranch) {
  const items = payload?.codeViewRepoRoute?.tree?.items;
  if (!items) return null;
  return {
    branch: payload.codeViewLayoutRoute?.refInfo?.name ?? fallbackBranch,
    items,
  };
}

export function githubDirectoryItems(payload, directory) {
  return payload?.codeViewTreeRoute?.tree?.items ??
    payload?.codeViewFileTreeLayoutRoute?.fileTree?.[directory]?.items ?? [];
}

export function githubBlobApiUrl(url) {
  return /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/git\/blobs\/[0-9a-f]+$/i.test(url);
}
