import { byteHash, parseCard } from './card.mjs';

const cardPath = /(?:card|character|chara|role|npc|角色|人物|cards|characters)/i;
export function meetsCardCriteria(card, { minWorldEntries = 0, minRegexScripts = 0, requiresExternalScript = false } = {}) {
  return card.worldEntries >= minWorldEntries && card.regexScripts >= minRegexScripts &&
    (!requiresExternalScript || card.scriptDependencies.some(script => script.enabled && script.urls.length));
}

export function candidateCardPaths(files) {
  const directoryCounts = new Map();
  return files.filter(file => file.type === 'blob' &&
    (file.size ?? 0) <= 20_000_000 &&
    /\.(?:json|png|charx)$/i.test(file.path) && cardPath.test(file.path) &&
    !/(?:index|manifest|prompt|lorebook|worldbook|meta|avatar|cover|readme|archive|manual|research|tests|\/docs\/)/i.test(file.path))
    .map(file => {
      const directory = file.path.slice(0, file.path.lastIndexOf('/') + 1);
      const order = directoryCounts.get(directory) ?? 0;
      directoryCounts.set(directory, order + 1);
      return { file, order };
    }).sort((a, b) => a.order - b.order).map(({ file }) => file);
}

export async function readCandidateBytes(response, limit = 20_000_000) {
  if (!response.ok || Number(response.headers.get('content-length')) > limit || !response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function inspectCardFile(name, bytes) {
  try {
    let cards;
    if (bytes[0] === 0x7B) {
      const json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      cards = json.spec === 'fy_pack_v1' && Array.isArray(json.cards) ? json.cards : [json];
    } else cards = [null];
    const result = [];
    let validFiles = 0;
    for (const raw of cards) {
      try {
        if (raw && !['chara_card_v2', 'chara_card_v3'].includes(raw.spec)) continue;
        const source = raw ? new TextEncoder().encode(JSON.stringify(raw)) : bytes;
        const card = await parseCard(source, name);
        validFiles++;
        const data = card.card.data;
        if (!['chara_card_v2', 'chara_card_v3'].includes(card.card.spec) ||
            typeof data.name !== 'string' || typeof data.first_mes !== 'string') continue;
        result.push({ path: name, name: data.name, spec: card.card.spec, format: card.format,
          cardUrlPath: name, sourceSha256: await byteHash(bytes), cardContentSha256: await byteHash(source),
          container: raw && cards.length > 1 ? 'fy_pack_v1' : undefined,
          worldEntries: card.report.worldEntries, regexScripts: card.report.regexScripts,
          scriptDependencies: card.report.scripts.map(({ name, enabled, urls }) => ({ name, enabled, urls })),
          resources: card.report.resources });
      } catch {}
    }
    return validFiles ? result : null;
  } catch { return null; }
}
