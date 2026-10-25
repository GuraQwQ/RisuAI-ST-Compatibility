import { byteHash } from './card.mjs';
import { createWorldEngine } from './vendor/world-info.mjs';

export function presetOrder(preset, orderId) {
  return preset.prompt_order.find(order => String(order.character_id) === String(orderId ?? 100001))
    ?? preset.prompt_order.find(order => order.order.some(item => item.enabled && preset.prompts.some(prompt =>
      prompt.identifier === item.identifier && prompt.content?.trim()))) ?? preset.prompt_order[0];
}

export async function parseAsset(bytes, filename, kind) {
  const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''));
  const hash = await byteHash(bytes);
  const name = String(data.name || filename.replace(/\.json$/i, ''));
  if (kind === 'preset') {
    if (!Array.isArray(data.prompts) || !data.prompts.length || !Array.isArray(data.prompt_order) || !data.prompt_order.length
      || data.prompts.some(prompt => typeof prompt.identifier !== 'string' || (prompt.content !== undefined && typeof prompt.content !== 'string'))
      || data.prompt_order.some(order => !Array.isArray(order.order) || order.order.some(item => typeof item.identifier !== 'string'))) {
      throw new Error('需要包含 prompts 与 prompt_order 的 ST Chat Completion 预设');
    }
    if (new Set(data.prompts.map(prompt => prompt.identifier)).size !== data.prompts.length) throw new Error('预设条目标识重复');
    const macroEngine = data.prompts.some(prompt => /{{\s*[#.]|{{\s*getvarkey\b/i.test(prompt.content ?? '')) ? 'modern' : 'legacy';
    return { kind, hash, name, filename, data, macroEngine, orderId: presetOrder(data).character_id,
      report: { prompts: data.prompts.length, regex: data.extensions?.regex_scripts?.length ?? 0 } };
  }
  if (kind !== 'worldbook' || !data.entries || typeof data.entries !== 'object') throw new Error('需要包含 entries 的 ST 世界书或角色世界书');
  const entries = Array.isArray(data.entries)
    ? Object.values(createWorldEngine({ extension_prompt_roles: { SYSTEM: 0, USER: 1, ASSISTANT: 2 } }).convertCharacterBook(data).entries) : Object.values(data.entries);
  if (entries.some(entry => !entry || typeof entry.content !== 'string' || (entry.key !== undefined && !Array.isArray(entry.key)))) throw new Error('世界书条目格式无效');
  return { kind, hash, name, filename, data, entries: entries.map((entry, index) => ({ ...entry, uid: entry.uid ?? index, world: hash })),
    report: { entries: entries.length } };
}

export function assetSnapshot(binding, assets = {}) {
  const imported = assets[binding.presetHash]?.kind === 'preset' ? assets[binding.presetHash] : undefined;
  let preset;
  if (imported?.kind === 'preset') {
    preset = JSON.parse(JSON.stringify(imported.data));
    const order = presetOrder(preset, binding.presetOrderId);
    for (const item of order.order) if (Object.hasOwn(binding.presetToggles ?? {}, item.identifier)) item.enabled = binding.presetToggles[item.identifier];
  }
  return { preset, promptOrderId: imported ? presetOrder(preset, binding.presetOrderId).character_id : undefined,
    macroEngine: binding.macroEngine ?? imported?.macroEngine ?? 'legacy',
    presetRegex: preset?.extensions?.regex_scripts ?? [],
    books: { ...binding.books, character: [...binding.books?.character ?? [],
      ...(binding.worldbookHashes ?? []).flatMap(hash => assets[hash]?.kind === 'worldbook' ? assets[hash].entries : [])] } };
}

export function assetSettings(binding, assets = {}) {
  const imported = assets[binding.presetHash]?.kind === 'preset' ? assets[binding.presetHash] : undefined;
  const order = imported && presetOrder(imported.data, binding.presetOrderId);
  return { characterName: binding.card?.data?.name ?? binding.card?.name ?? '',
    library: Object.values(assets).map(({ hash, name, kind, report }) => ({ hash, name, kind, report })),
    presetHash: binding.presetHash ?? '', worldbookHashes: binding.worldbookHashes ?? [],
    macroEngine: binding.macroEngine ?? imported?.macroEngine ?? 'legacy',
    orderId: order?.character_id, orders: imported?.data.prompt_order.map(item => item.character_id) ?? [],
    prompts: order?.order.map(item => { const prompt = imported.data.prompts.find(p => p.identifier === item.identifier);
      return { identifier: item.identifier, name: prompt?.name ?? item.identifier, role: prompt?.role ?? '',
        enabled: binding.presetToggles?.[item.identifier] ?? !!item.enabled }; }) ?? [] };
}
