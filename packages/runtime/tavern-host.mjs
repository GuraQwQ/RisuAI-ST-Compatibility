import mergeWith from 'lodash/mergeWith.js';
import { createWorldEngine } from '../core/vendor/world-info.mjs';
import { createRegexEngine } from '../core/vendor/regex.mjs';
import { presetOrder } from '../core/assets.mjs';
import { parseCard } from '../core/card.mjs';
import { normalizeScriptTrees } from '../core/frontend-resources.mjs';

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const merge = (base, update) => mergeWith(clone(base), clone(update), (_left, right) => Array.isArray(right) ? right : undefined);
const positions = ['before_character_definition', 'after_character_definition', 'before_author_note', 'after_author_note', 'at_depth', 'before_example_messages', 'after_example_messages', 'outlet'];
const logic = ['and_any', 'not_all', 'not_any', 'and_all'];
const roles = ['system', 'user', 'assistant'];
const regexPlacements = [1, 2, 3, 5, 6];
const placeholders = ['worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality', 'scenario', 'worldInfoAfter', 'dialogueExamples', 'chatHistory'];
const systemPrompts = ['main', 'nsfw', 'jailbreak', 'enhanceDefinitions'];
const implicitWorldFields = { addMemo: true, matchPersonaDescription: false, matchCharacterDescription: false,
  matchCharacterPersonality: false, matchCharacterDepthPrompt: false, matchScenario: false, matchCreatorNotes: false,
  group: '', groupOverride: false, groupWeight: 100, caseSensitive: null, matchWholeWords: null,
  useGroupScoring: null, automationId: '', ignoreBudget: false, outletName: '', triggers: [],
  characterFilter: { isExclude: false, names: [], tags: [] } };
const worldImplicit = entry => Object.fromEntries(Object.entries(implicitWorldFields).map(([key, fallback]) => [key, clone(entry[key] ?? fallback)]));
const parseKeyword = value => {
  const match = typeof value === 'string' && value.match(/^\/(.*)\/([dgimsuvy]*)$/s);
  if (match) { try { return new RegExp(match[1], match[2]); } catch {} }
  return value;
};
const defaultSettings = { max_context: 2000000, max_completion_tokens: 300, reply_count: 1, should_stream: false,
  temperature: 1, frequency_penalty: 0, presence_penalty: 0, repetition_penalty: 1, top_p: 1, min_p: 0, top_k: 0, top_a: 0,
  seed: -1, squash_system_messages: false, reasoning_effort: 'auto', request_thoughts: false, request_images: false,
  enable_function_calling: false, enable_web_search: false, allow_sending_images: 'disabled', allow_sending_videos: false,
  character_name_prefix: 'none', wrap_user_messages_in_quotes: false };
const defaultPreset = () => ({ settings: clone(defaultSettings), prompts: placeholders.map(id => ({ id, name: id,
  enabled: true, position: { type: 'relative' }, role: 'system' })), prompts_unused: [],
  extensions: { tavern_helper: { scripts: [], variables: {} } } });
const settingFields = { max_context: 'openai_max_context', max_completion_tokens: 'openai_max_tokens', reply_count: 'n',
  should_stream: 'stream_openai', temperature: 'temperature', frequency_penalty: 'frequency_penalty', presence_penalty: 'presence_penalty',
  top_p: 'top_p', repetition_penalty: 'repetition_penalty', min_p: 'min_p', top_k: 'top_k', top_a: 'top_a', seed: 'seed',
  squash_system_messages: 'squash_system_messages', reasoning_effort: 'reasoning_effort', request_thoughts: 'show_thoughts',
  request_images: 'request_images', enable_function_calling: 'function_calling', enable_web_search: 'enable_web_search',
  allow_sending_videos: 'video_inlining', wrap_user_messages_in_quotes: 'wrap_in_quotes' };
const worldSettingFields = { scan_depth: 'world_info_depth', context_percentage: 'world_info_budget', budget_cap: 'world_info_budget_cap',
  min_activations: 'world_info_min_activations', max_depth: 'world_info_min_activations_depth_max', max_recursion_steps: 'world_info_max_recursion_steps',
  include_names: 'world_info_include_names', recursive: 'world_info_recursive', case_sensitive: 'world_info_case_sensitive',
  match_whole_words: 'world_info_match_whole_words', use_group_scoring: 'world_info_use_group_scoring', overflow_alert: 'world_info_overflow_alert' };

function toWorld(entry) {
  return { uid: entry.uid, name: entry.comment ?? '', enabled: !entry.disable,
    strategy: { type: entry.constant ? 'constant' : entry.vectorized ? 'vectorized' : 'selective', keys: (entry.key ?? []).map(parseKeyword),
      keys_secondary: { logic: logic[entry.selectiveLogic ?? 0], keys: (entry.keysecondary ?? []).map(parseKeyword) }, scan_depth: entry.scanDepth ?? 'same_as_global' },
    position: { type: positions[entry.position ?? 4], role: roles[entry.role ?? 0], depth: entry.depth ?? 4, order: entry.order ?? 100 },
    content: entry.content ?? '', probability: entry.useProbability === false ? 100 : entry.probability ?? 100,
    recursion: { prevent_incoming: !!entry.excludeRecursion, prevent_outgoing: !!entry.preventRecursion,
      delay_until: typeof entry.delayUntilRecursion === 'number' && entry.delayUntilRecursion > 0 ? entry.delayUntilRecursion : null },
    effect: { sticky: entry.sticky || null, cooldown: entry.cooldown || null, delay: entry.delay || null },
    ...worldImplicit(entry), ...(entry.extra === undefined ? {} : { extra: clone(entry.extra) }) };
}
function fromWorld(entry, index, before = {}) {
  return { ...clone(before), uid: entry.uid, displayIndex: index, comment: entry.name ?? '', disable: !(entry.enabled ?? true),
    constant: (entry.strategy?.type ?? 'constant') === 'constant', selective: entry.strategy?.type === 'selective', vectorized: entry.strategy?.type === 'vectorized',
    key: (entry.strategy?.keys ?? []).map(String), keysecondary: (entry.strategy?.keys_secondary?.keys ?? []).map(String),
    selectiveLogic: logic.indexOf(entry.strategy?.keys_secondary?.logic ?? 'and_any'),
    scanDepth: entry.strategy?.scan_depth === 'same_as_global' ? null : entry.strategy?.scan_depth ?? null,
    position: positions.indexOf(entry.position?.type ?? 'at_depth'), role: roles.indexOf(entry.position?.role ?? 'system'),
    depth: entry.position?.depth ?? 4, order: entry.position?.order ?? 100, content: entry.content ?? '',
    probability: entry.probability ?? 100, useProbability: true, excludeRecursion: entry.recursion?.prevent_incoming ?? false,
    preventRecursion: entry.recursion?.prevent_outgoing ?? false, delayUntilRecursion: entry.recursion?.delay_until ?? false,
    sticky: entry.effect?.sticky ?? null, cooldown: entry.effect?.cooldown ?? null, delay: entry.effect?.delay ?? null,
    ...worldImplicit({ ...before, ...entry }), ...(entry.extra === undefined ? {} : { extra: clone(entry.extra) }) };
}
function toRegex(regex) {
  return { id: regex.id, script_name: regex.scriptName ?? '', enabled: !regex.disabled, find_regex: regex.findRegex ?? '',
    replace_string: regex.replaceString ?? '', trim_strings: clone(regex.trimStrings ?? []),
    source: Object.fromEntries(['user_input', 'ai_output', 'slash_command', 'world_info', 'reasoning'].map((name, index) => [name, (regex.placement ?? []).includes(regexPlacements[index])])),
    destination: { display: !!regex.markdownOnly, prompt: !!regex.promptOnly }, run_on_edit: !!regex.runOnEdit,
    min_depth: typeof regex.minDepth === 'number' && regex.minDepth >= 0 ? regex.minDepth : null,
    max_depth: typeof regex.maxDepth === 'number' && regex.maxDepth >= 0 ? regex.maxDepth : null };
}
function fromRegex(regex) {
  return { id: regex.id ?? crypto.randomUUID(), scriptName: regex.script_name ?? '', disabled: !regex.enabled,
    findRegex: regex.find_regex ?? '', replaceString: regex.replace_string ?? '', trimStrings: clone(regex.trim_strings ?? []),
    placement: ['user_input', 'ai_output', 'slash_command', 'world_info', 'reasoning'].flatMap((key, index) => regex.source?.[key] ? [regexPlacements[index]] : []),
    markdownOnly: !!regex.destination?.display, promptOnly: !!regex.destination?.prompt, runOnEdit: !!regex.run_on_edit,
    minDepth: regex.min_depth ?? null, maxDepth: regex.max_depth ?? null, substituteRegex: 0 };
}
function toPreset(asset, binding = {}) {
  const raw = clone(asset.data), order = presetOrder(raw, binding.presetOrderId);
  const convert = prompt => ({ id: prompt.identifier, name: prompt.name ?? 'unnamed',
    enabled: binding.presetToggles?.[prompt.identifier] ?? order.order.find(item => item.identifier === prompt.identifier)?.enabled ?? prompt.enabled ?? true,
    ...(!systemPrompts.includes(prompt.identifier) ? { position: prompt.injection_position === 1
      ? { type: 'in_chat', depth: prompt.injection_depth ?? 4, order: prompt.injection_order ?? 100 } : { type: 'relative' } } : {}),
    role: prompt.role ?? 'system', ...(!placeholders.includes(prompt.identifier) ? { content: prompt.content ?? '' } : {}),
    ...(prompt.extra === undefined ? {} : { extra: prompt.extra }) });
  const used = new Set(order.order.map(item => item.identifier));
  return { settings: { ...defaultSettings, ...Object.fromEntries(Object.entries(settingFields).filter(([, field]) => raw[field] !== undefined).map(([name, field]) => [name, raw[field]])),
    allow_sending_images: raw.image_inlining ? raw.inline_image_quality ?? 'auto' : 'disabled',
    character_name_prefix: ({ '-1': 'none', 0: 'default', 2: 'content', 1: 'completion' })[raw.names_behavior ?? -1] },
    prompts: order.order.map(item => raw.prompts.find(prompt => prompt.identifier === item.identifier)).filter(Boolean).map(convert),
    prompts_unused: raw.prompts.filter(prompt => !used.has(prompt.identifier)).map(convert),
    extensions: { ...raw.extensions, regex_scripts: (raw.extensions?.regex_scripts ?? []).map(toRegex) } };
}
function fromPreset(preset, before = {}) {
  const ids = new Set();
  const prompts = [...preset.prompts ?? [], ...preset.prompts_unused ?? []].map(prompt => {
    let id = prompt.id ?? crypto.randomUUID();
    if (ids.has(id)) {
      if (systemPrompts.includes(id) || placeholders.includes(id)) throw new Error(`预设中的系统/占位提示词重复：${id}`);
      id = crypto.randomUUID();
    }
    ids.add(id);
    return { identifier: id, name: prompt.name ?? 'unnamed', enabled: prompt.enabled ?? true,
      injection_position: prompt.position?.type === 'in_chat' ? 1 : 0, injection_depth: prompt.position?.depth ?? 4,
      injection_order: prompt.position?.order ?? 100, role: prompt.role ?? 'system', content: prompt.content ?? '',
      system_prompt: systemPrompts.includes(id) || placeholders.includes(id), marker: placeholders.includes(id),
      forbid_overrides: false, ...(prompt.extra === undefined ? {} : { extra: clone(prompt.extra) }) };
  });
  const settings = { ...defaultSettings, ...preset.settings };
  return { ...clone(before), ...Object.fromEntries(Object.entries(settingFields).map(([name, field]) => [field, settings[name]])),
    image_inlining: settings.allow_sending_images !== 'disabled', inline_image_quality: settings.allow_sending_images,
    names_behavior: ({ none: -1, default: 0, content: 2, completion: 1 })[settings.character_name_prefix],
    prompts, prompt_order: [{ character_id: 100001, order: prompts.slice(0, preset.prompts?.length ?? 0).map(prompt => ({ identifier: prompt.identifier, enabled: prompt.enabled })) }],
    extensions: { ...clone(preset.extensions ?? {}), regex_scripts: (preset.extensions?.regex_scripts ?? []).map(fromRegex) } };
}

/** 原始导入文件保留；运行时资源、实名绑定和用户改动写入现有数据库。 */
export function createTavernHost({ native, snapshot, refresh = () => {}, publish = () => {}, request, parseTemplate, executeSlash } = {}) {
  const db = () => native.db();
  const current = () => db().characters[native.selected()];
  const state = () => {
    const value = db().stCompatibilityHost ??= {};
    for (const [key, initial] of Object.entries({ globalWorldbooks: [], globalRegex: [], globalScripts: [], files: {}, archivedChats: {} })) value[key] ??= clone(initial);
    if (value.version !== 1) value.version = 1;
    return value;
  };
  const assets = () => db().stCompatibilityAssets ??= {};
  const binding = target => target.stCompatibility ??= { enabled: false, provider: 'risu', card: { data: { name: target.name,
    description: target.desc ?? '', first_mes: target.firstMessage ?? '', alternate_greetings: clone(target.alternateGreetings ?? []),
    personality: target.personality ?? '', scenario: target.scenario ?? '', mes_example: target.exampleMessage ?? '', extensions: {} } } };
  const data = target => binding(target).card.data ?? binding(target).card;
  const id = target => target.stCompatibility?.tavernAvatarId ?? `${target.chaId}.png`;
  const find = (name = 'current', context = {}, required = true) => {
    const target = name === 'current' ? context.characterId ? db().characters.find(item => item.chaId === context.characterId) : current()
      : db().characters.find(item => item.chaId === name || id(item) === name || item.name === name);
    if (!target && required) throw new Error(`角色不存在：${name}`);
    return target;
  };
  const contextOf = context => {
    const target = find('current', context);
    const chat = context.chatId ? target.chats.find(item => item.id === context.chatId) : target.chats[target.chatPage];
    if (!chat) throw new Error('聊天不存在');
    return { target, chat };
  };
  const changed = (context, events = [], render = 'affected') => {
    const target = find('current', context, false), chat = target?.chats.find(item => item.id === context.chatId) ?? target?.chats[target.chatPage];
    if (!chat) { refresh(context.chatId); return; }
    if (render !== 'none') refresh(chat.id);
    publish(chat.id, render === 'all' ? [...events, { name: 'chat_id_changed', args: [chat.id] }] : events, context.frameChannel);
  };
  const newAsset = (kind, name, fields) => {
    const hash = `runtime:${crypto.randomUUID()}`;
    const asset = { kind, hash, name, filename: `${name}.json`, ...fields };
    assets()[hash] = asset; return asset;
  };
  const ensureNames = () => {
    const used = new Set();
    for (const asset of Object.values(assets())) {
      const kind = `${asset.kind}:`;
      const original = asset.tavernName ?? asset.name ?? asset.hash;
      let name = original, serial = 0;
      while (used.has(kind + name)) name = `${original} (${asset.hash.slice(-8)}${serial++ ? `-${serial}` : ''})`;
      if (asset.tavernName !== name) asset.tavernName = name;
      used.add(kind + name);
    }
  };
  const resource = (kind, name, required = true) => {
    ensureNames();
    const asset = Object.values(assets()).find(item => item.kind === kind && item.tavernName === name);
    if (!asset && required) throw new Error(`${kind === 'preset' ? '预设' : '世界书'}不存在：${name}`);
    return asset;
  };
  const initialize = () => {
    state(); ensureNames();
    const world = createWorldEngine({ extension_prompt_roles: { SYSTEM: 0, USER: 1, ASSISTANT: 2 } });
    for (const target of db().characters) {
      if (!target.stCompatibility) continue;
      const b = binding(target);
      if (!b.worldbookBindings) {
        let primary = null;
        const book = data(target).character_book;
        if (book) {
          const existing = Object.values(assets()).find(item => item.kind === 'worldbook' && item.characterId === target.chaId);
          const imported = existing ?? newAsset('worldbook', book.name ?? `${target.name} 世界书`, {
            characterId: target.chaId, data: clone(book), entries: Object.values(world.convertCharacterBook(clone(book)).entries), report: { entries: book.entries?.length ?? 0 } });
          ensureNames(); primary = imported.tavernName;
        }
        b.worldbookBindings = { primary, additional: (b.worldbookHashes ?? []).map(hash => assets()[hash]?.tavernName).filter(Boolean) };
        for (const [name, entries] of Object.entries(b.books ?? {})) {
          if (!Array.isArray(entries) || !entries.length) continue;
          const imported = resource('worldbook', name, false) ?? newAsset('worldbook', name, { entries: clone(entries), data: { entries: clone(entries) }, report: { entries: entries.length } });
          ensureNames();
          if (name === 'global') state().globalWorldbooks = [...new Set([...state().globalWorldbooks, imported.tavernName])];
          else if (name === 'chat') { const chat = target.chats[target.chatPage]; chat.stCompatibility ??= {}; chat.stCompatibility.worldbookName ??= imported.tavernName; }
          else b.worldbookBindings.additional = [...new Set([...b.worldbookBindings.additional, imported.tavernName])];
        }
        b.worldbookHashes = b.worldbookBindings.additional.map(name => resource('worldbook', name).hash);
      } else {
        const additional = (b.worldbookHashes ?? []).map(hash => assets()[hash]?.tavernName).filter(Boolean);
        if (JSON.stringify(b.worldbookBindings.additional) !== JSON.stringify(additional)) b.worldbookBindings.additional = additional;
      }
      if (!b.hostGlobalRegexMigrated) {
        state().globalRegex = [...state().globalRegex, ...(b.globalRegex ?? []).filter(regex => !state().globalRegex.some(existing => existing.id === regex.id))];
        b.hostGlobalRegexMigrated = true;
      }
    }
  };
  const rawEntries = name => resource('worldbook', name).entries ?? [];
  const getWorldbook = name => [...rawEntries(name)].sort((left, right) => (left.displayIndex ?? 0) - (right.displayIndex ?? 0)).map(toWorld);
  const replaceWorldbook = (name, entries, context) => {
    if (!Array.isArray(entries)) throw new TypeError('世界书条目必须是数组');
    const asset = resource('worldbook', name), used = new Set(), before = asset.entries ?? [];
    const converted = entries.map((entry, index) => {
      let uid = Number.isInteger(entry.uid) ? entry.uid : 0;
      while (used.has(uid)) uid++;
      used.add(uid); return fromWorld({ ...entry, uid }, index, before.find(old => old.uid === uid));
    });
    Object.assign(asset, { entries: converted, data: { ...asset.data, entries: Object.fromEntries(converted.map(entry => [entry.uid, entry])) }, report: { ...asset.report, entries: converted.length } });
    changed(context, [{ name: 'worldinfo_updated', args: [name] }]);
  };
  const makeWorldbook = (name, entries, context) => {
    const existing = resource('worldbook', name, false);
    if (!existing) newAsset('worldbook', name, { data: { entries: {} }, entries: [], report: { entries: 0 } });
    replaceWorldbook(name, entries ?? [], context); return !existing;
  };
  const validateBooks = names => names.forEach(name => resource('worldbook', name));
  const getPreset = (name, context) => {
    const b = binding(find('current', context));
    const asset = name === 'in_use' ? assets()[b.presetHash] : resource('preset', name);
    return asset ? toPreset(asset, name === 'in_use' ? b : {}) : defaultPreset();
  };
  const replacePreset = (name, preset, context, create = false) => {
    const b = binding(find('current', context));
    let asset = name === 'in_use' ? assets()[b.presetHash] : resource('preset', name, !create);
    const existed = !!asset;
    const raw = fromPreset(preset, asset?.data);
    if (!asset) asset = newAsset('preset', name === 'in_use' ? '当前预设' : name, { data: raw, report: {} });
    Object.assign(asset, { data: raw, orderId: 100001, macroEngine: raw.prompts.some(prompt => /{{\s*[#.]|{{\s*getvarkey\b/i.test(prompt.content ?? '')) ? 'modern' : 'legacy',
      report: { prompts: raw.prompts.length, regex: raw.extensions.regex_scripts.length } });
    if (name === 'in_use') Object.assign(b, { presetHash: asset.hash, presetOrderId: 100001, presetToggles: {}, macroEngine: asset.macroEngine });
    changed(context); return !existed;
  };
  const regexStore = (option, context) => {
    if (!['global', 'character', 'preset'].includes(option?.type)) throw new Error('正则作用域必须为 global、character 或 preset');
    if (option.type === 'global') return { get: () => state().globalRegex, set: value => { state().globalRegex = value; } };
    const object = option.type === 'character' ? data(find(option.name ?? 'current', context))
      : (option.name === undefined || option.name === 'in_use' ? assets()[binding(find('current', context)).presetHash]
        : resource('preset', option.name))?.data;
    if (!object) throw new Error('当前角色尚未选择预设');
    return { get: () => object.extensions?.regex_scripts ?? [], set: value => { object.extensions ??= {}; object.extensions.regex_scripts = value; } };
  };
  const scripts = (option, context) => {
    if (!['global', 'character', 'preset'].includes(option?.type)) throw new Error('脚本作用域必须为 global、character 或 preset');
    if (option.type === 'global') return { get: () => state().globalScripts, set: value => { state().globalScripts = value; } };
    const object = option.type === 'character' ? data(find('current', context)) : assets()[binding(find('current', context)).presetHash]?.data;
    if (!object) throw new Error('当前角色尚未选择预设');
    return { get: () => object.extensions?.tavern_helper?.scripts ?? [], set: value => {
      object.extensions ??= {}; object.extensions.tavern_helper ??= {}; object.extensions.tavern_helper.scripts = value;
    } };
  };
  const allScripts = context => ['global', 'preset', 'character'].flatMap(type => {
    try { return scripts({ type }, context).get(); } catch { return []; }
  }).flatMap(tree => tree.type === 'folder' ? tree.enabled === false ? [] : tree.scripts : [tree]);
  const currentScript = context => {
    const script = allScripts(context).find(script => script.id === context.scriptId);
    if (!script) throw new Error('当前脚本不存在');
    return script;
  };
  const readMessages = (target, chat) => {
    const b = chat.stCompatibility ?? {}, offset = b.greetingMaterialized ? 0 : 1;
    const result = chat.message.map((message, index) => {
      const stored = message.stCompatibility ?? {}, swipe = stored.swipes?.current ?? 0;
      return { message_id: index + offset, storage_id: message.chatId ?? `legacy:${index}`, name: stored.name ?? (message.role === 'user' ? db().username : target.name),
        role: stored.role ?? (message.role === 'char' ? 'assistant' : 'user'), is_hidden: !!message.disabled, message: message.data ?? '',
        data: clone(stored.swipes?.data?.[swipe] ?? stored.state?.variables ?? {}), extra: clone(stored.extra ?? {}), swipe_id: swipe,
        swipes: clone(stored.swipes?.messages ?? [message.data ?? '']), swipes_data: clone(stored.swipes?.data ?? [stored.state?.variables ?? {}]),
        swipes_info: clone(stored.swipes?.info ?? [stored.extra ?? {}]) };
    });
    if (offset) {
      const swipe = b.greetingSwipe ?? Math.max(0, (chat.fmIndex ?? -1) + 1), swipes = [target.firstMessage ?? '', ...target.alternateGreetings ?? []];
      swipes[swipe] = b.greetingMessage ?? swipes[swipe] ?? '';
      result.unshift({ message_id: 0, storage_id: null, name: target.name, role: 'assistant', is_hidden: false,
        message: swipes[swipe], data: clone(b.greetingVariables?.[swipe] ?? {}), extra: {}, swipe_id: swipe, swipes,
        swipes_data: clone(b.greetingVariables ?? []), swipes_info: [] });
    }
    return result;
  };
  const materialize = (target, chat) => {
    if (chat.stCompatibility?.greetingMaterialized) return;
    const existing = chat.message.find(message => message.stCompatibility?.greetingOrigin);
    const greeting = readMessages(target, chat)[0], before = clone(chat.stCompatibility ?? {});
    const greetingMessage = existing ?? { role: 'char', data: greeting.message, saying: target.chaId, chatId: `${chat.id}:greeting`, time: Date.now(),
      stCompatibility: { greetingOrigin: true, state: { variables: greeting.data }, swipes: { current: greeting.swipe_id,
        messages: greeting.swipes, data: greeting.swipes_data, info: greeting.swipes_info } } };
    Object.assign(chat, { message: existing ? chat.message : [greetingMessage, ...chat.message], stCompatibility: { ...before,
      greetingOriginal: before.greetingOriginal ?? { fmIndex: chat.fmIndex, firstMessage: target.firstMessage,
        alternateGreetings: clone(target.alternateGreetings ?? []), greetingMessage: before.greetingMessage,
        greetingVariables: clone(before.greetingVariables), greetingSwipe: before.greetingSwipe }, greetingMaterialized: true } });
  };
  const invalidate = chat => { for (const message of chat.message) if (message.stCompatibility) delete message.stCompatibility.lineage; };
  const indexOf = (value, length, boundary = false) => {
    const integer = value === 'latest' || value === undefined ? length - 1 : Number(value);
    if (!Number.isInteger(integer)) throw new RangeError(`消息索引无效：${value}`);
    return Math.max(0, Math.min(length - (boundary ? 0 : 1), integer < 0 ? length + integer : integer));
  };
  const fromMessage = (message, target) => ({ role: message.role === 'assistant' ? 'char' : 'user', data: message.message ?? '', disabled: !!message.is_hidden,
    chatId: crypto.randomUUID(), saying: target.chaId, time: Date.now(), stCompatibility: { name: message.name ?? (message.role === 'user' ? db().username : target.name),
      role: message.role, extra: clone(message.extra ?? {}), state: { variables: clone(message.data ?? {}) } } });
  const persona = (value = 'current', required = true) => {
    const item = value === 'current' ? db().personas?.[db().selectedPersona ?? 0]
      : db().personas?.find(item => item.id === value || `${item.id}.png` === value || item.name.toLowerCase() === value.toLowerCase());
    if (!item && required) throw new Error(`用户角色不存在：${value}`);
    return item;
  };
  const toPersona = item => ({ avatar_id: `${item.id}.png`, avatar: item.icon || `${item.id}.png`, name: item.name,
    title: item.stCompatibility?.title ?? '', description: item.personaPrompt ?? '', position: item.stCompatibility?.position ?? 0,
    depth: item.stCompatibility?.depth ?? 2, role: item.stCompatibility?.role ?? 0, lorebook: item.stCompatibility?.lorebook ?? '',
    connections: clone(item.stCompatibility?.connections ?? []), is_default: state().defaultPersonaId === item.id });
  const applyPersona = (item, value) => {
    if (value.name !== undefined) item.name = value.name;
    if (value.description !== undefined) item.personaPrompt = value.description;
    if (typeof value.avatar === 'string') item.icon = value.avatar;
    item.stCompatibility = merge(item.stCompatibility ?? {}, value);
    if (value.is_default) state().defaultPersonaId = item.id;
    if (db().personas[db().selectedPersona ?? 0] === item) Object.assign(db(), { username: item.name, personaPrompt: item.personaPrompt, userIcon: item.icon });
  };
  const toCharacter = target => ({ avatar: id(target), version: target.characterVersion ?? data(target).character_version ?? '', creator: target.creator ?? '',
    creator_notes: target.creatorNotes ?? '', description: target.desc ?? '', first_messages: [target.firstMessage ?? '', ...target.alternateGreetings ?? []],
    worldbook: binding(target).worldbookBindings?.primary ?? null, extensions: { ...clone(data(target).extensions ?? {}),
      regex_scripts: (data(target).extensions?.regex_scripts ?? []).map(toRegex), tavern_helper: clone(data(target).extensions?.tavern_helper ?? { scripts: [], variables: {} }) } });
  const applyCharacter = async (target, value) => {
    const raw = data(target);
    const mapping = { version: ['characterVersion', 'character_version'], creator: ['creator', 'creator'], creator_notes: ['creatorNotes', 'creator_notes'], description: ['desc', 'description'] };
    for (const [field, [nativeField, cardField]] of Object.entries(mapping)) if (value[field] !== undefined) { target[nativeField] = value[field]; raw[cardField] = value[field]; }
    if (value.first_messages !== undefined) { target.firstMessage = raw.first_mes = value.first_messages[0] ?? ''; target.alternateGreetings = raw.alternate_greetings = clone(value.first_messages.slice(1)); }
    if (value.avatar instanceof Blob && native.saveAsset) target.image = await native.saveAsset(new Uint8Array(await value.avatar.arrayBuffer()), crypto.randomUUID(), id(target));
    if (value.worldbook !== undefined) { if (value.worldbook) validateBooks([value.worldbook]); binding(target).worldbookBindings ??= { primary: null, additional: [] }; binding(target).worldbookBindings.primary = value.worldbook; }
    if (value.extensions) {
      raw.extensions = merge(raw.extensions ?? {}, value.extensions);
      if (value.extensions.regex_scripts) raw.extensions.regex_scripts = value.extensions.regex_scripts.map(fromRegex);
    }
  };
  const rawCharacter = target => ({ ...clone(data(target)), name: target.name, avatar: id(target), description: target.desc,
    first_mes: target.firstMessage, creatorcomment: target.creatorNotes, data: { ...clone(data(target)), name: target.name,
      extensions: { ...clone(data(target).extensions ?? {}), world: binding(target).worldbookBindings?.primary ?? '' } } });
  const toLore = entry => {
    const world = toWorld(entry);
    return { uid: entry.uid, display_index: entry.displayIndex ?? 0, comment: world.name, enabled: world.enabled, type: world.strategy.type,
      position: world.position.type === 'at_depth' ? `at_depth_as_${world.position.role}` : world.position.type,
      depth: world.position.type === 'at_depth' ? world.position.depth : null, order: world.position.order, probability: world.probability,
      key: clone(entry.key ?? []), keys: clone(entry.key ?? []), filter: clone(entry.keysecondary ?? []), filters: clone(entry.keysecondary ?? []), logic: world.strategy.keys_secondary.logic, scan_depth: world.strategy.scan_depth,
      case_sensitive: entry.caseSensitive ?? 'same_as_global', match_whole_words: entry.matchWholeWords ?? 'same_as_global', use_group_scoring: entry.useGroupScoring ?? 'same_as_global',
      automation_id: entry.automationId || null, exclude_recursion: !!entry.excludeRecursion, prevent_recursion: !!entry.preventRecursion,
      delay_until_recursion: entry.delayUntilRecursion ?? false, content: world.content, group: entry.group ?? '', group_prioritized: !!entry.groupOverride,
      group_weight: entry.groupWeight ?? 100, ...world.effect };
  };
  const fromLore = entry => ({ uid: entry.uid, name: entry.comment, enabled: entry.enabled,
    strategy: { type: entry.type, keys: entry.keys ?? entry.key, keys_secondary: { keys: entry.filters ?? entry.filter, logic: entry.logic }, scan_depth: entry.scan_depth },
    position: { type: entry.position?.startsWith('at_depth_as_') ? 'at_depth' : entry.position, role: entry.position?.replace('at_depth_as_', '') ?? 'system', depth: entry.depth ?? 4, order: entry.order },
    content: entry.content, probability: entry.probability, recursion: { prevent_incoming: entry.exclude_recursion, prevent_outgoing: entry.prevent_recursion, delay_until: entry.delay_until_recursion },
    effect: { sticky: entry.sticky, cooldown: entry.cooldown, delay: entry.delay }, caseSensitive: entry.case_sensitive === 'same_as_global' ? null : entry.case_sensitive,
    matchWholeWords: entry.match_whole_words === 'same_as_global' ? null : entry.match_whole_words,
    useGroupScoring: entry.use_group_scoring === 'same_as_global' ? null : entry.use_group_scoring,
    automationId: entry.automation_id, group: entry.group, groupOverride: entry.group_prioritized, groupWeight: entry.group_weight });
  initialize();

  const methods = {
    getWorldbookNames: () => Object.values(assets()).filter(asset => asset.kind === 'worldbook').map(asset => asset.tavernName),
    getGlobalWorldbookNames: () => clone(state().globalWorldbooks),
    rebindGlobalWorldbooks: ([names], context) => { validateBooks(names); state().globalWorldbooks = [...new Set(names)]; changed(context); },
    getCharWorldbookNames: ([name = 'current'], context) => clone(binding(find(name, context)).worldbookBindings),
    rebindCharWorldbooks: ([name, names], context) => { validateBooks([names.primary, ...names.additional ?? []].filter(Boolean)); const b = binding(find(name, context)); b.worldbookBindings = { primary: names.primary ?? null, additional: [...new Set(names.additional ?? [])] };
      b.worldbookHashes = b.worldbookBindings.additional.map(name => resource('worldbook', name).hash); changed(context); },
    getChatWorldbookName: (_args, context) => contextOf(context).chat.stCompatibility?.worldbookName ?? null,
    rebindChatWorldbook: ([_name, name], context) => { if (name) validateBooks([name]); const { chat } = contextOf(context); chat.stCompatibility ??= {}; chat.stCompatibility.worldbookName = name; changed(context); },
    getOrCreateChatWorldbook: async ([_chat, name], context) => {
      const currentName = methods.getChatWorldbookName([], context); if (currentName) return currentName;
      name ??= `${find('current', context).name} ${contextOf(context).chat.id}`;
      if (!resource('worldbook', name, false)) makeWorldbook(name, [], context);
      methods.rebindChatWorldbook(['current', name], context); return name;
    },
    getWorldbook: ([name]) => getWorldbook(name),
    createWorldbook: ([name, entries = []], context) => resource('worldbook', name, false) ? false : makeWorldbook(name, entries, context),
    createOrReplaceWorldbook: ([name, entries = []], context) => makeWorldbook(name, entries, context),
    replaceWorldbook: ([name, entries], context) => replaceWorldbook(name, entries, context),
    updateWorldbookWith: async ([name, updater], context) => { replaceWorldbook(name, await updater(getWorldbook(name)), context); return getWorldbook(name); },
    createWorldbookEntries: ([name, entries], context) => { const before = getWorldbook(name); replaceWorldbook(name, [...before, ...entries], context); const worldbook = getWorldbook(name); return { worldbook, new_entries: worldbook.slice(before.length) }; },
    deleteWorldbookEntries: ([name, predicate], context) => { const before = getWorldbook(name), deleted_entries = before.filter(entry => typeof predicate === 'function' ? predicate(entry) : predicate.includes(entry.uid)); replaceWorldbook(name, before.filter(entry => !deleted_entries.some(deleted => deleted.uid === entry.uid)), context); return { worldbook: getWorldbook(name), deleted_entries }; },
    deleteWorldbook: ([name], context) => {
      const asset = resource('worldbook', name, false); if (!asset) return false;
      delete assets()[asset.hash]; state().globalWorldbooks = state().globalWorldbooks.filter(value => value !== name);
      for (const target of db().characters) if (target.stCompatibility) {
        const b = binding(target); if (b.worldbookBindings.primary === name) b.worldbookBindings.primary = null;
        b.worldbookBindings.additional = b.worldbookBindings.additional.filter(value => value !== name);
        b.worldbookHashes = (b.worldbookHashes ?? []).filter(value => value !== asset.hash);
        for (const chat of target.chats) if (chat.stCompatibility?.worldbookName === name) chat.stCompatibility.worldbookName = null;
      }
      changed(context); return true;
    },
    getPresetNames: () => ['in_use', ...Object.values(assets()).filter(asset => asset.kind === 'preset').map(asset => asset.tavernName)],
    getLoadedPresetName: (_args, context) => assets()[binding(find('current', context)).presetHash]?.tavernName ?? '默认',
    loadPreset: ([name], context) => { const asset = resource('preset', name, false); if (!asset) return false;
      Object.assign(binding(find('current', context)), { presetHash: asset.hash, presetOrderId: asset.orderId ?? 100001, presetToggles: {}, macroEngine: asset.macroEngine }); changed(context); return true; },
    getPreset: ([name = 'in_use'], context) => getPreset(name, context),
    createPreset: ([name, preset = defaultPreset()], context) => resource('preset', name, false) ? false : replacePreset(name, preset, context, true),
    createOrReplacePreset: ([name, preset = defaultPreset()], context) => replacePreset(name, preset, context, true),
    replacePreset: ([name, preset], context) => { replacePreset(name, preset, context); },
    setPreset: ([name, update], context) => { const preset = merge(getPreset(name, context), update); replacePreset(name, preset, context); return getPreset(name, context); },
    updatePresetWith: async ([name, updater], context) => { replacePreset(name, await updater(getPreset(name, context)), context); return getPreset(name, context); },
    deletePreset: ([name], context) => { if (name === 'in_use') throw new Error('不能删除 in_use'); const asset = resource('preset', name, false); if (!asset) return false;
      delete assets()[asset.hash]; for (const target of db().characters) if (target.stCompatibility?.presetHash === asset.hash) Object.assign(target.stCompatibility, { presetHash: '', presetToggles: {}, presetOrderId: undefined }); changed(context); return true; },
    renamePreset: ([name, newName], context) => { const asset = resource('preset', name, false); if (!asset) return false; if (resource('preset', newName, false)) return false;
      asset.tavernName = asset.name = newName; changed(context); return true; },
    getCharacterNames: () => db().characters.map(target => target.name), getCharacterIds: () => db().characters.map(id),
    getCurrentCharacterName: (_args, context) => find('current', context, false)?.name ?? null,
    getCurrentCharacterId: (_args, context) => { const target = find('current', context, false); return target ? id(target) : null; },
    getCharacter: ([name = 'current'], context) => toCharacter(find(name, context)),
    createCharacter: async ([name, value = {}], context) => {
      if (name === 'current' || find(name, context, false)) return false;
      const target = native.blank(); target.chaId ??= crypto.randomUUID(); target.name = name.endsWith('.png') ? name.slice(0, -4) : name;
      Object.assign(binding(target), { enabled: true, provider: 'local', localResponse: '' });
      binding(target).tavernAvatarId = name.endsWith('.png') ? name : `${target.chaId}.png`; binding(target).worldbookBindings = { primary: null, additional: [] };
      data(target).name = target.name; target.chats ??= []; if (!target.chats.length) target.chats.push({ id: crypto.randomUUID(), name: '聊天', message: [], localLore: [], note: '', fmIndex: -1 });
      target.chatPage = 0; await applyCharacter(target, value); db().characters.push(target); native.order(); changed(context); return true;
    },
    createOrReplaceCharacter: async ([name, value = {}], context) => { const target = find(name, context, false); if (!target) return methods.createCharacter([name, value], context); await applyCharacter(target, value); changed(context); return false; },
    replaceCharacter: async ([name, value], context) => { await applyCharacter(find(name, context), value); changed(context); },
    updateCharacterWith: async ([name, updater], context) => { const target = find(name, context); await applyCharacter(target, await updater(toCharacter(target))); changed(context); return toCharacter(target); },
    deleteCharacter: ([name, options = {}], context) => { const target = find(name, context, false); if (!target) return false;
      if (!options.delete_chats) state().archivedChats[id(target)] = clone(target.chats);
      const index = db().characters.indexOf(target); db().characters.splice(index, 1); native.select(Math.min(native.selected(), db().characters.length - 1)); native.order(); refresh(context.chatId); return true; },
    getCharData: ([name = 'current'], context) => { const target = find(name, context, false); return target ? rawCharacter(target) : null; },
    getCharAvatarPath: ([name = 'current'], context) => find(name, context, false)?.image ?? null,
    getChatHistoryBrief: ([name = 'current'], context) => { const target = find(name, context, false); return target ? target.chats.map(chat => ({ file_name: `${chat.id}.jsonl`, character_name: target.name, avatar: id(target), chat_items: chat.message.length + (chat.stCompatibility?.greetingMaterialized ? 0 : 1), preview_message: chat.message.at(-1)?.data ?? target.firstMessage, last_mes: chat.lastDate ?? 0 })) : null; },
    getChatHistoryDetail: ([files]) => Object.fromEntries(files.map(file => { const target = db().characters.find(item => item.name === file.character_name || id(item) === file.avatar), chat = target?.chats.find(item => `${item.id}.jsonl` === file.file_name || item.id === file.file_name); return [file.file_name, chat ? readMessages(target, chat).map(message => ({ name: message.name, is_user: message.role === 'user', mes: message.message, extra: message.extra, variables: message.swipes_data, swipe_id: message.swipe_id, swipes: message.swipes })) : null]; })),
    getPersonaNames: () => (db().personas ?? []).map(item => item.name), getPersonaIds: () => (db().personas ?? []).map(item => `${item.id}.png`),
    getCurrentPersonaName: () => persona('current', false)?.name ?? null, getCurrentPersonaId: () => { const item = persona('current', false); return item ? `${item.id}.png` : null; },
    getPersona: ([value = 'current']) => toPersona(persona(value)), getPersonaAvatarPath: ([value = 'current']) => persona(value, false)?.icon ?? null,
    createPersona: ([name, value = {}], context) => { db().personas ??= []; if (name === 'current' || persona(name, false)) return false; const item = { id: crypto.randomUUID(), name, personaPrompt: '', icon: '' }; db().personas.push(item); applyPersona(item, value); changed(context); return true; },
    createOrReplacePersona: ([name, value = {}], context) => { const item = persona(name, false); if (!item) return methods.createPersona([name, value], context); applyPersona(item, value); changed(context); return false; },
    replacePersona: ([name, value], context) => { applyPersona(persona(name), value); changed(context); },
    updatePersonaWith: async ([name, updater], context) => { const item = persona(name); applyPersona(item, await updater(toPersona(item))); changed(context); return toPersona(item); },
    deletePersona: ([name], context) => { const item = persona(name, false); if (!item) return false; db().personas.splice(db().personas.indexOf(item), 1); db().selectedPersona = Math.min(db().selectedPersona ?? 0, Math.max(0, db().personas.length - 1));
      const selected = persona('current', false); if (selected) applyPersona(selected, {}); changed(context); return true; },
    getTavernRegexes: ([option], context) => clone(regexStore(option, context).get().map(toRegex)),
    replaceTavernRegexes: ([regexes, option], context) => { regexStore(option, context).set(regexes.map(fromRegex)); changed(context); },
    updateTavernRegexesWith: async ([updater, option], context) => { methods.replaceTavernRegexes([await updater(methods.getTavernRegexes([option], context)), option], context); return methods.getTavernRegexes([option], context); },
    isCharacterTavernRegexesEnabled: (_args, context) => binding(find('current', context)).regexEnabled !== false,
    formatAsTavernRegexedString: ([text, source, destination, option = {}], context) => {
      const target = find(option.character_name ?? 'current', context);
      const engine = createRegexEngine({ getRegexScripts: () => [...state().globalRegex, ...assets()[binding(target).presetHash]?.data.extensions?.regex_scripts ?? [], ...data(target).extensions?.regex_scripts ?? []],
        substituteParams: value => native.parser(value, { chara: target }), substituteParamsExtended: value => native.parser(value, { chara: target }), extension_settings: { disabledExtensions: [] }, console });
      return engine.getRegexedString(text, regexPlacements[['user_input', 'ai_output', 'slash_command', 'world_info', 'reasoning'].indexOf(source)], { isMarkdown: destination === 'display', isPrompt: destination === 'prompt', depth: option.depth });
    },
    getScriptTrees: ([option], context) => clone(scripts(option, context).get()),
    replaceScriptTrees: ([trees, option], context) => { scripts(option, context).set(normalizeScriptTrees(trees)); changed(context); },
    updateScriptTreesWith: async ([updater, option], context) => { const value = await updater(methods.getScriptTrees([option], context)); methods.replaceScriptTrees([value, option], context); return methods.getScriptTrees([option], context); },
    getAllEnabledScriptButtons: (_args, context) => Object.fromEntries(allScripts(context).filter(script => script.enabled && script.button?.enabled).map(script => [script.id, (script.button.buttons ?? []).filter(button => button.visible).map(button => ({ button_id: `${script.id}_${button.name}`, button_name: button.name }))])),
    replaceScriptButtons: ([buttons], context) => { currentScript(context).button = { enabled: true, buttons: clone(buttons) }; changed(context); },
    replaceScriptInfo: ([info], context) => { currentScript(context).info = String(info); changed(context); },
    getChatMessages: ([range = 'latest', options = {}], context) => {
      const { target, chat } = contextOf(context), messages = readMessages(target, chat), match = typeof range === 'string' && range.match(/^(-?\d+)-(-?\d+)$/);
      const start = indexOf(match ? match[1] : range, messages.length), end = indexOf(match ? match[2] : range, messages.length);
      return messages.slice(start, end + 1).filter(message => (!options.role || options.role === 'all' || message.role === options.role) && (!options.hide_state || options.hide_state === 'all' || message.is_hidden === (options.hide_state === 'hidden')))
        .map(message => options.include_swipes ? { message_id: message.message_id, name: message.name, role: message.role, is_hidden: message.is_hidden, swipe_id: message.swipe_id, swipes: message.swipes, swipes_data: message.swipes_data, swipes_info: message.swipes_info }
          : { message_id: message.message_id, name: message.name, role: message.role, is_hidden: message.is_hidden, message: message.message, data: message.data, extra: message.extra });
    },
    setChatMessages: ([changes, options = {}], context) => {
      const { target, chat } = contextOf(context), before = readMessages(target, chat);
      const updates = changes.filter(change => Number.isInteger(change.message_id) && change.message_id >= -before.length && change.message_id < before.length).map(change => {
        const index = change.message_id < 0 ? before.length + change.message_id : change.message_id;
        const value = { ...before[index], ...clone(change) }, swipe = value.swipe_id ?? 0;
        if (value.swipes && (!Number.isInteger(swipe) || swipe < 0 || swipe >= value.swipes.length)) throw new RangeError('swipe 索引不存在');
        if (!Object.hasOwn(change, 'data')) value.data = clone(value.swipes_data?.[swipe] ?? {});
        return { index, value };
      });
      if (!updates.length) return;
      materialize(target, chat);
      for (const { index, value } of updates) {
        const item = chat.message[index], stored = item.stCompatibility ??= {}, swipe = value.swipe_id ?? 0;
        item.role = value.role === 'assistant' ? 'char' : 'user'; item.disabled = !!value.is_hidden;
        Object.assign(stored, { name: value.name, role: value.role, extra: clone(value.extra ?? {}),
          swipes: { current: swipe, messages: clone(value.swipes), data: clone(value.swipes_data), info: clone(value.swipes_info) } });
        item.data = Object.hasOwn(changes.find(change => (change.message_id < 0 ? before.length + change.message_id : change.message_id) === index), 'message') ? value.message : value.swipes[swipe];
        stored.swipes.messages[swipe] = item.data;
        stored.state ??= {}; stored.state.variables = value.data ?? stored.swipes.data[swipe] ?? {};
        stored.swipes.data[swipe] = clone(stored.state.variables);
      }
      invalidate(chat); changed(context, updates.flatMap(({ index, value }) => [
        { name: 'message_updated', args: [index] }, ...(options.refresh === 'none' ? [] : [{
          name: value.role === 'user' ? 'user_message_rendered' : 'character_message_rendered', args: [index] }]),
      ]), options.refresh);
    },
    createChatMessages: ([messages, options = {}], context) => { const { target, chat } = contextOf(context); if (!messages.length) return;
      const converted = messages.map(message => { if (!roles.includes(message.role) || typeof message.message !== 'string') throw new TypeError('消息需要有效的 role 和 message'); return fromMessage(message, target); });
      const length = readMessages(target, chat).length, before = options.insert_at ?? options.insert_before ?? 'end';
      const index = before === 'end' ? length : indexOf(before, length, true);
      materialize(target, chat); chat.message.splice(index, 0, ...converted); invalidate(chat);
      changed(context, converted.flatMap((message, offset) => [
        { name: message.role === 'user' ? 'message_sent' : 'message_received', args: [index + offset, 'extension'] },
        ...(options.refresh === 'none' ? [] : [{ name: message.role === 'user' ? 'user_message_rendered' : 'character_message_rendered', args: [index + offset] }]),
      ]), options.refresh);
    },
    deleteChatMessages: ([ids, options = {}], context) => { const { target, chat } = contextOf(context), length = readMessages(target, chat).length;
      const selected = [...new Set(ids.filter(value => Number.isInteger(value) && value >= -length && value < length).map(value => value < 0 ? length + value : value))].sort((a, b) => b - a);
      if (!selected.length) return; materialize(target, chat); selected.forEach(index => chat.message.splice(index, 1)); invalidate(chat); changed(context, [{ name: 'message_deleted', args: [chat.message.length] }], options.refresh); },
    rotateChatMessages: ([begin, middle, end, options = {}], context) => { const { target, chat } = contextOf(context), length = readMessages(target, chat).length;
      begin = indexOf(begin, length, true); end = indexOf(end, length, true); middle = Math.max(begin, Math.min(end, indexOf(middle, length, true)));
      if (begin >= middle || middle >= end) return; materialize(target, chat); chat.message.splice(begin, 0, ...chat.message.splice(middle, end - middle)); invalidate(chat); changed(context, [], options.refresh); },
    getLorebookSettings: () => clone({ selected_global_lorebooks: state().globalWorldbooks, scan_depth: 2, context_percentage: 25, budget_cap: 0, min_activations: 0, max_depth: 0, max_recursion_steps: 0,
      insertion_strategy: 'evenly', include_names: true, recursive: false, case_sensitive: false, match_whole_words: false, use_group_scoring: false, overflow_alert: false, ...state().lorebookSettings }),
    setLorebookSettings: ([settings], context) => { if (settings.selected_global_lorebooks) methods.rebindGlobalWorldbooks([settings.selected_global_lorebooks], context); state().lorebookSettings = merge(methods.getLorebookSettings(), settings); changed(context); },
    getLorebookEntries: ([name, options = {}]) => rawEntries(name).map(toLore).filter(entry => !options.filter || options.filter === 'none' || Object.entries(options.filter).every(([key, value]) => Array.isArray(entry[key]) ? value.every(item => entry[key].includes(item)) : typeof entry[key] === 'string' ? entry[key].includes(value) : entry[key] === value)),
    replaceLorebookEntries: ([name, entries], context) => replaceWorldbook(name, entries.map(fromLore), context),
    setLorebookEntries: ([name, entries], context) => { const current = methods.getLorebookEntries([name]); methods.replaceLorebookEntries([name, current.map(entry => merge(entry, entries.find(change => change.uid === entry.uid) ?? {}))], context); return methods.getLorebookEntries([name]); },
    updateLorebookEntriesWith: async ([name, updater], context) => { methods.replaceLorebookEntries([name, await updater(methods.getLorebookEntries([name]))], context); return methods.getLorebookEntries([name]); },
    createLorebookEntries: ([name, entries], context) => { const current = methods.getLorebookEntries([name]); methods.replaceLorebookEntries([name, [...current, ...entries]], context); const result = methods.getLorebookEntries([name]); return { entries: result, new_uids: result.slice(current.length).map(entry => entry.uid) }; },
    deleteLorebookEntries: ([name, uids], context) => { const current = methods.getLorebookEntries([name]), remaining = current.filter(entry => !uids.includes(entry.uid)); methods.replaceLorebookEntries([name, remaining], context); return { entries: methods.getLorebookEntries([name]), delete_occurred: remaining.length !== current.length }; },
    getCharLorebooks: ([options = {}], context) => { const names = methods.getCharWorldbookNames([options.name ?? 'current'], context); return options.type === 'primary' ? { primary: names.primary, additional: [] } : options.type === 'additional' ? { primary: null, additional: names.additional } : names; },
    getCurrentCharPrimaryLorebook: (_args, context) => methods.getCharWorldbookNames(['current'], context).primary,
    setCurrentCharLorebooks: ([names], context) => methods.rebindCharWorldbooks(['current', { ...methods.getCharWorldbookNames(['current'], context), ...names }], context),
    getOrCreateChatLorebook: ([name], context) => methods.getOrCreateChatWorldbook(['current', name], context),
    getChatLorebook: (_args, context) => methods.getChatWorldbookName(['current'], context),
    setChatLorebook: ([name], context) => methods.rebindChatWorldbook(['current', name], context),
    injectPrompts: ([prompts, options = {}], context) => { const { chat } = contextOf(context); chat.stCompatibility ??= {}; chat.stCompatibility.injectedPrompts ??= {};
      for (const prompt of prompts) chat.stCompatibility.injectedPrompts[prompt.id] = { ...clone(prompt), once: !!options.once }; changed(context); },
    uninjectPrompts: ([ids], context) => { const { chat } = contextOf(context); for (const id of ids) delete chat.stCompatibility?.injectedPrompts?.[id]; changed(context); },
    triggerSlash: async ([command], context) => { if (!executeSlash) throw new Error('Slash 执行器尚未接通'); const result = await executeSlash(command, context); return result?.pipe ?? result; },
    saveExtensionSettings: ([settings]) => { state().extensionSettings = clone(settings); },
    substitudeMacros: ([text], context) => parseTemplate ? parseTemplate(text, context) : native.parser(text, { chara: find('current', context) }),
    getExtensionInstallationInfo: () => null,
    getTavernFile: async ([name]) => { const file = state().files[name]; if (!file) return { status: 404, statusText: 'Not Found', headers: {}, body: '' }; return { status: 200, statusText: 'OK', headers: { 'content-type': file.type ?? 'application/octet-stream' }, body: file.base64, base64: true }; },
    uploadTavernFile: ([name, base64], context) => { atob(base64); state().files[name] = { base64 }; changed(context); return name; },
    deleteTavernFile: ([name], context) => { const exists = Object.hasOwn(state().files, name); delete state().files[name]; changed(context); return exists; },
    importRawPreset: ([name, content], context) => { try { const raw = JSON.parse(content); if (!Array.isArray(raw.prompts) || !Array.isArray(raw.prompt_order)) return false; const existing = resource('preset', name, false); if (existing) existing.data = raw; else newAsset('preset', name, { data: raw, orderId: presetOrder(raw).character_id, report: { prompts: raw.prompts.length, regex: raw.extensions?.regex_scripts?.length ?? 0 } }); ensureNames(); changed(context); return true; } catch { return false; } },
    importRawWorldbook: ([name, content], context) => { const raw = JSON.parse(content); if (!raw.entries || typeof raw.entries !== 'object') throw new Error('世界书需要 entries'); const existing = resource('worldbook', name, false) ?? newAsset('worldbook', name, { data: raw, entries: [], report: {} }); existing.entries = Object.values(raw.entries); existing.data = raw; existing.report.entries = existing.entries.length; ensureNames(); changed(context); return { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }; },
    importRawTavernRegex: ([name, content], context) => { const regex = JSON.parse(content); if (typeof regex.findRegex !== 'string') return false; state().globalRegex.push({ ...regex, id: crypto.randomUUID(), scriptName: name }); changed(context); return true; },
    importRawChat: ([name, content], context) => { const { target } = contextOf(context); const lines = content.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
      const header = lines[0]?.chat_metadata ? lines.shift() : {};
      const messages = lines.map(message => fromMessage({ role: message.is_user ? 'user' : message.extra?.type === 'narrator' ? 'system' : 'assistant', message: message.mes ?? '', name: message.name, is_hidden: message.is_system, data: message.variables?.[message.swipe_id ?? 0], extra: message.extra }, target));
      const chat = { id: crypto.randomUUID(), name, message: messages, localLore: [], note: '', fmIndex: -1, stCompatibility: { greetingMaterialized: true, state: { metadata: header.chat_metadata ?? {} } } }; target.chats.push(chat); changed(context); return { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ res: true, id: chat.id }) }; },
    importRawCharacter: async ([name, content], context) => { const bytes = content instanceof Blob ? new Uint8Array(await content.arrayBuffer()) : new Uint8Array(content.bytes ?? content);
      const parsed = await parseCard(bytes, name), raw = parsed.card.data ?? parsed.card, old = find(name.replace(/\.(json|png)$/i, ''), context, false);
      const target = old ?? native.blank(); target.chaId ??= crypto.randomUUID(); target.name = raw.name;
      target.stCompatibility = { ...target.stCompatibility, card: parsed.card, enabled: true, hash: parsed.hash, provider: 'local' };
      target.stCompatibility.worldbookBindings = { primary: null, additional: [] };
      Object.assign(target, { desc: raw.description ?? '', personality: raw.personality ?? '', scenario: raw.scenario ?? '', firstMessage: raw.first_mes ?? '', alternateGreetings: raw.alternate_greetings ?? [], creatorNotes: raw.creator_notes ?? '', creator: raw.creator ?? '', characterVersion: raw.character_version ?? '' });
      if (!old) { db().characters.push(target); native.order(); } delete target.stCompatibility.worldbookBindings; initialize(); changed(context);
      return { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file_name: id(target) }) }; },
  };
  methods.getLorebooks = methods.getWorldbookNames; methods.createLorebook = methods.createWorldbook; methods.deleteLorebook = methods.deleteWorldbook;
  const snapshotData = (target = current(), chat = target?.chats[target.chatPage]) => {
    initialize();
    const b = binding(target), person = persona('current', false), names = b.worldbookBindings;
    const worldbookBindings = { global: clone(state().globalWorldbooks), character: clone(names), persona: person?.stCompatibility?.lorebook ?? '', chat: chat.stCompatibility?.worldbookName ?? null };
    const entries = names => [...new Set(names.filter(Boolean))].flatMap(name => resource('worldbook', name, false)?.entries.map(entry => ({ ...clone(entry), world: name })) ?? []);
    const extensionPrompts = Object.fromEntries(Object.values(chat.stCompatibility?.injectedPrompts ?? {}).map(prompt => [prompt.id, { value: prompt.content, position: prompt.position === 'none' ? -1 : 1, depth: prompt.depth, role: roles.indexOf(prompt.role), scan: !!prompt.should_scan }]));
    return { worldbooks: Object.fromEntries(methods.getWorldbookNames().map(name => [name, clone(rawEntries(name))])), worldbookBindings,
      books: { global: entries(worldbookBindings.global), character: entries([names.primary, ...names.additional]), chat: entries([worldbookBindings.chat]), persona: entries([worldbookBindings.persona]) },
      characters: db().characters.map(rawCharacter), avatar: target.image, userAvatar: person?.icon ?? db().userIcon, quickReplies: clone(state().quickReplies ?? []),
      extensionPrompts, globalRegex: clone(state().globalRegex), settings: {
        ...Object.fromEntries(Object.entries(worldSettingFields).filter(([name]) => state().lorebookSettings?.[name] !== undefined)
          .map(([name, field]) => [field, state().lorebookSettings[name]])),
        ...(state().lorebookSettings?.insertion_strategy === undefined ? {} : {
          world_info_character_strategy: ['evenly', 'character_first', 'global_first'].indexOf(state().lorebookSettings.insertion_strategy) }) } };
  };
  methods.getFrontendState = (_args, context) => {
    const target = find('current', context, false);
    if (!target) return { messages: [], tavern: { characters: db().characters.map(target => ({ name: target.name, id: id(target), data: toCharacter(target), raw: rawCharacter(target) })), currentCharacterId: null } };
    const { chat } = contextOf(context); initialize(); const stateData = snapshotData(target, chat);
    const presets = Object.fromEntries(methods.getPresetNames().map(name => [name, getPreset(name, context)]));
    return { messages: readMessages(target, chat), tavern: { characters: db().characters.map(target => ({ name: target.name, id: id(target), data: toCharacter(target), raw: rawCharacter(target) })),
      currentCharacterId: id(target), personas: (db().personas ?? []).map(item => ({ name: item.name, id: `${item.id}.png`, data: toPersona(item) })),
      currentPersonaId: methods.getCurrentPersonaId(), presets, loadedPresetName: methods.getLoadedPresetName([], context),
      worldbooks: Object.fromEntries(methods.getWorldbookNames().map(name => [name, getWorldbook(name)])), globalWorldbookNames: stateData.worldbookBindings.global,
      charWorldbooks: Object.fromEntries(db().characters.filter(target => target.stCompatibility).flatMap(target => [[id(target), clone(binding(target).worldbookBindings)], [target.chaId, clone(binding(target).worldbookBindings)]])),
      chatWorldbookName: stateData.worldbookBindings.chat, tavernRegexes: { global: state().globalRegex.map(toRegex), character: (data(target).extensions?.regex_scripts ?? []).map(toRegex), preset: presets.in_use.extensions?.regex_scripts ?? [] },
      characterTavernRegexesEnabled: methods.isCharacterTavernRegexesEnabled([], context), scriptTrees: Object.fromEntries(['global', 'preset', 'character'].map(type => { try { return [type, methods.getScriptTrees([{ type }], context)]; } catch { return [type, []]; } })),
      lorebookSettings: methods.getLorebookSettings(), proxyPresetNames: clone(db().botPresets?.map(preset => preset.name) ?? []), files: clone(state().files),
      extensionSettings: clone(state().extensionSettings ?? {}),
      extensions: { [context.extensionId ?? 'st-compatibility']: { type: 'system' } }, context: clone(context) } };
  };
  return { has: method => Object.hasOwn(methods, method), call: (method, args = [], context = {}) => {
    initialize(); if (!Object.hasOwn(methods, method)) throw new Error(`宿主接口不存在：${method}`); return methods[method](args, context);
  }, snapshotData };
}
