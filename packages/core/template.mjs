import ejs from 'ejs/ejs.min.js';
import _ from 'lodash';
import * as YAML from 'yaml';
import { faker } from '@faker-js/faker';
import { createWorldEngine } from './vendor/world-info.mjs';
import { createTemplatePrimitives, templateSources } from './template-primitives.mjs';
import { createTemplateContext } from './template-context.mjs';

export { templateSources };
export const templateDefaults = { enabled: true, generate_enabled: true, generate_loader_enabled: true,
  render_enabled: true, render_loader_enabled: true, with_context_disabled: false, debug_enabled: false,
  autosave_enabled: false, preload_worldinfo_enabled: true, code_blocks_enabled: false,
  raw_message_evaluation_enabled: true, filter_message_enabled: true, cache_enabled: 0, cache_size: 64,
  cache_hasher: 'h32ToString', inject_loader_enabled: false, invert_enabled: true, depth_limit: -1,
  compile_workers: false, sandbox: false, code_editor: false, preload_only: true };

const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const parseRegex = value => {
  if (value instanceof RegExp) return value;
  const match = typeof value === 'string' && value.match(/^\/(.*)\/([dgimsuvy]*)$/s);
  if (!match) return null;
  try { return new RegExp(match[1], match[2]); } catch { return null; }
};
const hashString = value => {
  let hash = 0;
  for (let index = 0; index < value.length; index++) hash = (hash * 31 + value.charCodeAt(index)) | 0;
  return String(hash >>> 0);
};

/** 执行上下文、变量缓存与临时正则属于一次聊天求值，外部宿主负责提交持久化。 */
export function createTemplateSession(snapshot, state = {}, { host = {}, phase = 'generate', messageId,
  substitute = text => String(text ?? ''), regex = text => text, diagnostics = [] } = {}) {
  const data = snapshot.card?.data ?? snapshot.card ?? {};
  const persisted = state.template ??= {};
  const settings = Object.assign({}, templateDefaults, persisted.features, snapshot.templateFeatures);
  const console = Object.fromEntries(['debug', 'log', 'info', 'warn', 'error'].map(level => [level,
    (...args) => diagnostics.push({ level, text: args.map(value => value?.message ?? String(value)).join(' ') })]));
  const toastr = Object.fromEntries(['info', 'success', 'warning', 'error'].map(level => [level,
    (message, title) => host.notify?.(level, title ? `${title}: ${message}` : message) ?? console.log(message)]));
  const Math = Object.create(globalThis.Math);
  Math.random = host.random ?? globalThis.Math.random;
  const chat = [];
  if (!snapshot.chat?.stCompatibility?.greetingMaterialized) chat.push({ mes: snapshot.greeting ?? data.first_mes ?? '',
    name: data.name, is_user: false, is_system: false,
    swipe_id: snapshot.chat?.stCompatibility?.greetingSwipe ?? Math.max(0, (snapshot.chat?.fmIndex ?? -1) + 1),
    variables: _.cloneDeep(snapshot.chat?.stCompatibility?.greetingVariables ?? [snapshot.greetingVariables ?? {}]) });
  for (const message of snapshot.chat?.message ?? []) chat.push({ ...message, mes: message.data ?? message.message ?? '',
    name: message.name ?? (message.role === 'user' ? snapshot.user : data.name), is_user: message.role === 'user',
    is_system: message.role === 'system', swipe_id: message.stCompatibility?.swipes?.current ?? message.swipe_id ?? 0,
    variables: _.cloneDeep(message.stCompatibility?.swipes?.data ?? message.variables ?? [message.stCompatibility?.state?.variables ?? {}]),
    variables_initialized: [true] });
  if (!chat.length) chat.push({ mes: '', name: data.name, is_user: false, is_system: false, swipe_id: 0, variables: [{}] });
  const current = messageId == null ? Math.max(0, chat.length - 1 - Number(['swipe', 'append', 'continue', 'appendFinal'].includes(snapshot.operation)))
    : Math.max(0, Math.min(chat.length - 1, messageId < 0 ? chat.length + messageId : messageId));
  chat[current].variables[chat[current].swipe_id] = state.variables ?? {};
  const beforeMessages = _.cloneDeep(chat.map(message => message.variables));
  const metadata = state.metadata ??= {};
  metadata.variables ??= {};
  const globals = state.globals ??= {};
  const worldbooks = new Map();
  const convert = entries => Object.values(createWorldEngine({ extension_prompt_roles: { SYSTEM: 0, USER: 1, ASSISTANT: 2 } })
    .convertCharacterBook({ entries }).entries);
  const normalize = (entry, index, world) => ({ key: [], keysecondary: [], comment: '', content: '', order: 100, group: '',
    selective: false, vectorized: false, useProbability: false, probability: 100,
    position: 0, uid: entry.uid ?? entry.id ?? index, ...entry, disable: entry.disable ?? entry.enabled === false,
    constant: !!entry.constant, world, key: entry.key ?? entry.keys ?? [], keysecondary: entry.keysecondary ?? entry.secondary_keys ?? [] });
  const addBook = (name, value) => {
    if (!name || !value) return;
    const entries = Array.isArray(value) ? value : value.entries ?? value;
    if (typeof entries !== 'object') return;
    const normalized = Array.isArray(entries) && entries.some(entry => entry.keys)
      ? convert(entries) : Object.values(entries);
    worldbooks.set(name, normalized.map((entry, index) => normalize(entry, index, name)));
  };
  const primary = snapshot.worldbookBindings?.character?.primary ?? data.character_book?.name ?? data.extensions?.world ?? `card:${data.name ?? ''}`;
  if (data.character_book?.entries) addBook(primary, { entries: convert(data.character_book.entries) });
  for (const [name, value] of Object.entries(snapshot.worldbooks ?? {})) addBook(name, value);
  const groupedNames = {};
  for (const [scope, entries] of Object.entries(snapshot.books ?? {})) {
    if (!Array.isArray(entries)) continue;
    groupedNames[scope] = [];
    for (const entry of entries) {
      const world = entry.world ?? scope;
      if (!groupedNames[scope].includes(world)) groupedNames[scope].push(world);
      if (!worldbooks.has(world)) worldbooks.set(world, []);
      const list = worldbooks.get(world);
      if (!list.some(item => item.uid === (entry.uid ?? entry.id))) list.push(normalize(entry, list.length, world));
    }
  }
  const bindings = snapshot.worldbookBindings ?? {};
  const characters = (snapshot.characters ?? [data]).map(value => {
    const card = value.data ?? value;
    return { mes_example: '', description: '', personality: '', scenario: '', first_mes: '', ...card, ...value,
      data: { ...card, extensions: { ...card.extensions, world: card.character_book?.name ?? primary } }, avatar: value.avatar ?? value.image ?? '' };
  });
  const this_chid = Math.max(0, characters.findIndex(value => value.name === data.name));
  characters[this_chid].data.extensions.world = primary;
  const METADATA_KEY = 'world_info';
  metadata[METADATA_KEY] ??= bindings.chat ?? groupedNames.chat?.[0];
  const extra = bindings.character?.additional ?? groupedNames.character?.filter(name => name !== primary) ?? [];
  const eventSource = { emit: async (name, ...args) => { await host.eventEmit?.(name, ...args); } };
  const extension_settings = { variables: { global: globals }, regex: _.cloneDeep(snapshot.globalRegex ?? []) };
  const env = { chat, chat_metadata: metadata, extension_settings, settings, console, Math, toastr,
    saveChatConditional: async () => { await host.saveVariables?.(effects()); },
    loadWorldInfo: async name => { const entries = worldbooks.get(name); return entries ? { entries: Object.fromEntries(entries.map(entry => [entry.uid, _.cloneDeep(entry)])) } : null; },
    parseRegexFromString: parseRegex, world_info_case_sensitive: snapshot.settings?.world_info_case_sensitive ?? false,
    world_info_match_whole_words: snapshot.settings?.world_info_match_whole_words ?? false,
    world_info_use_group_scoring: snapshot.settings?.world_info_use_group_scoring ?? false,
    world_info_logic: { AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3 }, DEFAULT_WEIGHT: 100, DEFAULT_DEPTH: 4,
    world_info_position: { before: 0, after: 1, ANTop: 2, ANBottom: 3, atDepth: 4, EMTop: 5, EMBottom: 6, outlet: 7 },
    METADATA_KEY, selected_world_info: bindings.global ?? groupedNames.global ?? [], world_info: { charLore: [{ name: data.name, extraBooks: extra }] },
    world_names: [...worldbooks.keys()], substituteParams: substitute, this_chid, characters, eventSource,
    event_types: { WORLDINFO_FORCE_ACTIVATE: 'worldinfo_force_activate' }, name1: snapshot.user ?? 'User', name2: data.name ?? '',
    power_user: { persona_description_lorebook: bindings.persona ?? groupedNames.persona?.[0] },
    getCharaFilename: index => characters[index]?.name, getGroupMembers: () => snapshot.groups ?? [],
    world_info_max_recursion_steps: snapshot.settings?.world_info_max_recursion_steps ?? 32, hashString,
    evalTemplateHandler: (text, context, where, options) => render(text, context, options) };
  const primitives = createTemplatePrimitives(env);
  primitives.STATE.initialVariables = _.cloneDeep(persisted.initialVariables ?? {});
  primitives.precacheVariables(current);
  const defines = _.cloneDeep(persisted.defines ?? {});
  let runID = 0;
  let contextFunctions;
  const toContext = { ...env, ...primitives, evalTemplate: (text, context, options) => render(text, context, options),
    SharedDefines: defines, getCurrentChatId: () => snapshot.chat?.id ?? '', groups: snapshot.groups ?? [],
    selected_group: snapshot.groupId, user_avatar: snapshot.userAvatar ?? '', getThumbnailUrl: (_kind, avatar) => host.assetUrl?.(avatar) ?? avatar,
    getPersonaAvatar: avatar => host.assetUrl?.(avatar) ?? avatar, getRegexedString: regex,
    regex_placement: { USER_INPUT: 1, AI_OUTPUT: 2, WORLD_INFO: 3 }, getGeneratingModel: () => snapshot.model,
    getPresetPromptsContent: name => (snapshot.preset?.prompts ?? []).filter(prompt => prompt.name === name || prompt.identifier === name || name instanceof RegExp && name.test(prompt.name ?? '')).map(prompt => prompt.content ?? '').join('\n'),
    getQuickReply: (name, label) => snapshot.quickReplies?.find(set => set.name === name)?.qrList?.find(reply => reply.label === label)?.message,
    getQuickReplyData: name => snapshot.quickReplies?.find(set => set.name === name), fakerEnv: { faker: host.faker ?? faker },
    executeSlashCommandsWithOptions: async command => { if (!host.execute) throw new Error('模板命令需要宿主 Slash 接口'); return { pipe: await host.execute(command) }; },
    SillyTavern: host.SillyTavern ?? { getContext: () => ({ chat, chatMetadata: metadata, name1: snapshot.user, name2: data.name, eventSource }) },
    $: host.$, toastr };
  contextFunctions = createTemplateContext(toContext);
  const prepareContext = async (extraContext = {}, end = current) => contextFunctions.prepareContext(end, {
    user: snapshot.user ?? 'User', char: data.name, runType: phase, runID: runID++,
    message_id: end, swipe_id: chat[end]?.swipe_id ?? 0, generateType: snapshot.operation ?? 'normal',
    ...extraContext });
  const compileCache = new Map();
  function compileTemplate(text, options = {}, thisData = {}) {
    const supplied = options.options ?? options;
    const opts = { async: true, outputFunctionName: 'print', _with: !settings.with_context_disabled,
      localsName: 'locals', client: true, ...supplied };
    if (!opts._with && !opts.destructuredLocals) opts.destructuredLocals = Object.keys(supplied.context ?? thisData);
    const key = JSON.stringify([text, { ...opts, context: undefined, escape: undefined, includer: undefined }]);
    let compiled = opts.cache && compileCache.get(key);
    if (!compiled) {
      compiled = ejs.compile(text, opts);
      if (opts.cache) { compileCache.set(key, compiled); while (compileCache.size > Math.max(1, Number(settings.cache_size) || 64)) compileCache.delete(compileCache.keys().next().value); }
    }
    return async function (context = thisData) { return compiled.call(context, context, options.escaper ?? opts.escape ?? (value => value ?? ''),
      async (name, extraContext = {}) => {
        if (opts.includer) { const included = await opts.includer(name, name); return render(included.template, _.merge(context, extraContext), { options: opts }); }
        return context.getwi(name, extraContext);
      }); };
  }
  async function render(text, context, options = {}) {
    if (typeof text !== 'string' || !settings.enabled) return text;
    const opts = options.options ?? options;
    if (!text.includes(`${opts.openDelimiter ?? '<'}${opts.delimiter ?? '%'}`)) return text;
    const execution = context ?? await prepareContext();
    const compileOptions = { ...opts, context: execution, escape: options.escaper ?? opts.escape };
    if (settings.cache_enabled) compileOptions.cache ??= true;
    return compileTemplate(text, compileOptions)(execution);
  }
  const getSyntaxErrorInfo = code => {
    try { ejs.compile(code, { async: true, outputFunctionName: 'print', client: true }); return ''; }
    catch (error) { return `${error.message}\n${String(code).split('\n').map((line, index) => `${index + 1}: ${line}`).join('\n')}`; }
  };
  async function entriesFor(prefix, decorator, content, context, buffer = '') {
    const entries = primitives.selectActivatedEntries((await primitives.getEnabledWorldInfoEntries()).filter(entry => {
      const parsed = new primitives.WorldInfoDecorators(entry);
      const [name, ...args] = decorator.split(' ');
      return parsed.isEnabled && (entry.comment.startsWith(prefix) || parsed.decorators.some((item, index) =>
        item === name && (parsed.arguments[index] ?? '') === args.join(' ')));
    }), content ?? '', { vectorized: false });
    let result = '';
    for (const entry of entries) {
      const parsed = new primitives.WorldInfoDecorators(entry);
      if (await parsed.isConditionFiltedEntry(context)) continue;
      result += await render(primitives.applyRegex(context, substitute(parsed.cleanContent), { worldinfo: true,
        generate: prefix.startsWith('[GENERATE'), message: prefix.startsWith('[RENDER'), before: false, html: true }),
      _.merge(context, { world_info: entry, generateBuffer: buffer }));
    }
    return result;
  }
  async function initialize() {
    if (!settings.enabled || !settings.preload_worldinfo_enabled) return;
    const entries = await primitives.getEnabledWorldInfoEntries();
    primitives.STATE.initialVariables = {};
    const context = await prepareContext({ runType: 'preparation', isDryRun: true });
    primitives.STATE.isDryRun = true;
    try {
      for (const entry of entries) {
        const parsed = new primitives.WorldInfoDecorators(entry);
        if (!parsed.isEnabled || !parsed.has('@@initial_variables') && !entry.comment.startsWith('[InitialVariables]')) continue;
        const content = await render(primitives.applyRegex(context, substitute(parsed.cleanContent), { worldinfo: true }), context);
        let value;
        try { try { value = JSON.parse(content); } catch { value = YAML.parse(content); } }
        catch (error) { console.error(`初始变量解析失败：${entry.world}/${entry.comment}`, error); continue; }
        if (!_.isPlainObject(value)) { console.error(`初始变量条目必须是对象：${entry.world}/${entry.comment}`); continue; }
        _.mergeWith(primitives.STATE.initialVariables, value, (_old, next) => Array.isArray(next) ? next : undefined);
      }
      primitives.precacheVariables(current);
      if (settings.generate_loader_enabled) await entriesFor('[GENERATE:BEFORE]', '@@generate_before', '', context);
      for (const entry of entries) {
        const parsed = new primitives.WorldInfoDecorators(entry);
        if (parsed.isEnabled && parsed.isPreloadEntry && !await parsed.isConditionFiltedEntry(context)) {
          await render(substitute(parsed.cleanContent), _.merge(context, { world_info: entry }));
        }
      }
      await render(substitute(`${data.description ?? ''}\n---\n${data.scenario ?? ''}`), context);
      if (settings.generate_loader_enabled) await entriesFor('[GENERATE:AFTER]', '@@generate_after', '', context);
    } finally { primitives.STATE.isDryRun = false; }
  }
  async function prepareWorldEntries(entries) {
    if (!settings.enabled) return entries;
    const context = await prepareContext();
    const result = [];
    for (const entry of entries) {
      const parsed = new primitives.WorldInfoDecorators(entry);
      if (parsed.isSpecialEntry || !entry.disable && await parsed.isConditionFiltedEntry(context)) continue;
      let next = { ...entry, content: parsed.cleanContent };
      if (!entry.disable && parsed.isPreprocessingEntry) {
        next.content = await render(substitute(next.content), _.merge(context, { world_info: entry }));
        next.key = await Promise.all((entry.key ?? []).map(key => render(substitute(key), context)));
        next.keysecondary = await Promise.all((entry.keysecondary ?? []).map(key => render(substitute(key), context)));
      }
      if (parsed.isPrivateEntry) next.content = `<% await (async()=>{%>${next.content}<%})(); %>`;
      if (parsed.isForceActivation) next = { ...next, constant: true, disable: false, ignoreBudget: true, group: '' };
      if (parsed.isForceDeactivation) next.disable = true;
      result.push(next);
    }
    for (const entry of primitives.getActivatedWIEntries()) {
      const index = result.findIndex(item => item.world === entry.world && item.uid === entry.uid);
      if (index < 0) result.push(entry);
      else result[index] = entry;
    }
    return result;
  }
  let generateBefore, generateContext;
  async function beforeGenerate() {
    if (!settings.enabled || !settings.generate_enabled || generateContext) return;
    primitives.STATE.isDryRun = false;
    generateContext = await prepareContext({ runType: 'generate', isDryRun: false, message_id: undefined,
      swipe_id: undefined, is_last: undefined, is_user: undefined, is_system: undefined, name: undefined });
    generateBefore = settings.generate_loader_enabled
      ? await entriesFor('[GENERATE:BEFORE]', '@@generate_before', '', generateContext) : '';
  }
  async function processPrompt(messages) {
    if (!settings.enabled || !settings.generate_enabled) return messages;
    await beforeGenerate();
    const context = Object.assign(generateContext, { generateData: messages });
    primitives.setForceOutlet(true);
    try {
      const before = generateBefore ?? '';
      let buffer = before;
      for (const [index, message] of messages.entries()) {
        const beforeMessage = settings.generate_loader_enabled ? await entriesFor(`[GENERATE:${index}:BEFORE]`, `@@generate_before ${index}`, '', context, buffer) : '';
        const parts = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
        for (const part of parts ?? []) {
          if (part.type !== 'text' || typeof part.text !== 'string') continue;
          const text = primitives.applyRegex(context, part.text, { generate: true, role: message.role });
          const rendered = await render(text, context);
          const afterMessage = settings.generate_loader_enabled ? await entriesFor(`[GENERATE:${index}:AFTER]`, `@@generate_after ${index}`, rendered, context, buffer + beforeMessage + rendered) : '';
          part.text = beforeMessage + rendered + afterMessage;
          buffer += part.text;
        }
        if (typeof message.content === 'string') message.content = parts[0].text;
      }
      const after = settings.generate_loader_enabled ? await entriesFor('[GENERATE:AFTER]', '@@generate_after', buffer, context, before + buffer) : '';
      const allText = messages.flatMap(message => typeof message.content === 'string'
        ? [{ get text() { return message.content; }, set text(value) { message.content = value; } }]
        : (message.content ?? []).filter(part => part.type === 'text' && typeof part.text === 'string'));
      if (allText.length) { allText[0].text = before + allText[0].text; allText.at(-1).text += after; }
      else if (before || after) messages.push({ role: 'system', content: before + after });
      if (settings.inject_loader_enabled) await injectMessages(messages, context);
      primitives.setForceOutlet(false);
      for (const message of messages) {
        if (typeof message.content === 'string') message.content = primitives.applyOutletPromptsInjected(message.content);
        else for (const part of message.content ?? []) if (part.type === 'text') part.text = primitives.applyOutletPromptsInjected(part.text);
      }
      return messages;
    } finally { primitives.setForceOutlet(false); generateContext = undefined; generateBefore = undefined; }
  }
  async function injectMessages(messages, context) {
    const original = [...messages];
    const queued = [];
    const regexQueue = [];
    for (const entry of await primitives.getEnabledWorldInfoEntries()) {
      const parsed = new primitives.WorldInfoDecorators(entry);
      if (!parsed.isEnabled || !entry.comment.startsWith('@INJECT')) continue;
      if (await parsed.isConditionFiltedEntry(context)) continue;
      if (entry.useProbability && Math.floor(Math.random() * 100) + 1 > entry.probability) continue;
      const role = entry.comment.match(/role=(user|assistant|system)/)?.[1] ?? 'system';
      const content = await render(primitives.applyRegex(context, substitute(parsed.cleanContent),
        { generate: true, role, worldinfo: true }), _.merge(context, { world_info: entry }));
      if (!content?.trim()) continue;
      const at = entry.comment.match(/at=(before|after)/)?.[1] ?? 'before';
      const pos = entry.comment.match(/pos=(-?\d+)/)?.[1];
      const target = entry.comment.match(/target=(\w+)/)?.[1];
      const search = entry.comment.match(/regex=(?:"([^"]*)"|'([^']*)'|(\S+))/);
      let index;
      if (pos !== undefined) index = Number(pos) <= 0 ? Number(pos) === 0 ? 0 : original.length + Number(pos) : Number(pos) - 1;
      else if (target) {
        const candidates = original.map((message, index) => ({ ...message, index })).filter(message => message.role === target);
        const occurrence = Number(entry.comment.match(/index=(-?\d+)/)?.[1] ?? 1);
        index = candidates[occurrence < 0 ? candidates.length + occurrence : occurrence - 1]?.index;
        if (index !== undefined && at === 'after') index++;
      } else if (search) {
        regexQueue.push({ search: search[1] ?? search[2] ?? search[3], at, order: entry.order ?? 0, message: { role, content } });
        continue;
      }
      if (index === undefined) continue;
      queued.push({ index: Math.max(0, Math.min(messages.length, index)), order: entry.order ?? 0,
        isPos: pos !== undefined, message: { role, content } });
    }
    queued.sort((a, b) => b.index - a.index || b.order - a.order || Number(b.isPos) - Number(a.isPos));
    for (const item of queued) messages.splice(item.index, 0, item.message);
    const matches = [];
    for (const item of regexQueue) {
      try {
        const pattern = new RegExp(item.search);
        const index = messages.findIndex(message => pattern.test(typeof message.content === 'string'
          ? message.content : (message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n')));
        if (index >= 0) matches.push({ ...item, index: index + Number(item.at === 'after') });
      } catch (error) { console.error(`注入正则无效：${item.search}`, error); }
    }
    matches.sort((a, b) => b.index - a.index || b.order - a.order);
    for (const item of matches) messages.splice(item.index, 0, item.message);
  }
  async function processOutput(text, { renderOnly = false, html = false, messageId = current, escaper, dryRun = false } = {}) {
    if (!settings.enabled || !settings.render_enabled || settings.depth_limit >= 0 && chat.length - messageId - 1 > settings.depth_limit) return text;
    const previousDryRun = primitives.STATE.isDryRun;
    primitives.STATE.isDryRun = dryRun;
    try {
      const context = await prepareContext({ runType: renderOnly ? 'render' : 'render_permanent', message_id: messageId,
        is_last: messageId === chat.length - 1, is_user: chat[messageId]?.is_user, is_system: chat[messageId]?.is_system,
        name: chat[messageId]?.name, isDryRun: dryRun }, messageId);
      const options = { message: true, before: !renderOnly, after: renderOnly, html,
        user: !!chat[messageId]?.is_user, assistant: !chat[messageId]?.is_user && !chat[messageId]?.is_system,
        system: !!chat[messageId]?.is_system, depth: chat.length - messageId - 1 };
      const before = renderOnly && settings.render_loader_enabled ? await entriesFor('[RENDER:BEFORE]', '@@render_before', '', context) : '';
      let content = primitives.applyRegex(context, text, options);
      if (!renderOnly && !settings.raw_message_evaluation_enabled) return content;
      const blocks = [];
      content = content.replace(/<(escape-ejs|thinking|think|reasoning)\b[^>]*>[\s\S]*?<\/\1>/gi, value => `\u0000${blocks.push(value) - 1}\u0000`);
      if (renderOnly && !settings.code_blocks_enabled) content = content.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, value => `\u0000${blocks.push(value) - 1}\u0000`);
      if (html) content = content.replace(/&lt;%([\s\S]*?)%&gt;/g, (_match, code) => `<%${_.unescape(code)}%>`);
      content = await render(content, context, { escaper });
      content = content.replace(/\u0000(\d+)\u0000/g, (_match, index) => blocks[Number(index)]);
      if (renderOnly && settings.render_loader_enabled) content = before + content + await entriesFor('[RENDER:AFTER]', '@@render_after', content, context);
      return content;
    } finally { primitives.STATE.isDryRun = previousDryRun; }
  }
  function effects() {
    persisted.initialVariables = _.cloneDeep(primitives.STATE.initialVariables);
    persisted.features = { ...settings };
    persisted.defines = JSON.parse(JSON.stringify(defines, (_key, value) => typeof value === 'function' ? undefined : value));
    const writes = chat.flatMap((message, index) => JSON.stringify(message.variables) === JSON.stringify(beforeMessages[index]) ? [] : [{
      index: index - Number(!snapshot.chat?.stCompatibility?.greetingMaterialized), storageId: message.chatId ?? null,
      swipeId: message.swipe_id ?? 0, variables: _.cloneDeep(message.variables) }]);
    return { variables: _.cloneDeep(chat[current].variables[chat[current].swipe_id]), globals: _.cloneDeep(globals),
      metadata: _.cloneDeep(metadata), templateState: _.cloneDeep(persisted), messageVariables: writes, regex: _.cloneDeep(extension_settings.regex) };
  }
  return { initialize, prepareContext, evalTemplate: render, compileTemplate, getSyntaxErrorInfo, beforeGenerate, processPrompt, processOutput,
    prepareWorldEntries, getRegexes: () => extension_settings.regex,
    allVariables: primitives.precacheVariables, saveVariables: primitives.checkAndSave,
    getFeatures: () => ({ ...settings }), setFeatures: features => { Object.assign(settings, features); persisted.features = { ...settings }; },
    resetFeatures: () => { Object.assign(settings, templateDefaults); persisted.features = { ...settings }; },
    get defines() { return defines; }, get initialVariables() { return primitives.STATE.initialVariables; },
    get variables() { return chat[current].variables[chat[current].swipe_id]; },
    setVariables(value) { chat[current].variables[chat[current].swipe_id] = value; state.variables = value; primitives.precacheVariables(current); },
    syncState(value) {
      if (value.globals) { for (const key of Object.keys(globals)) delete globals[key]; Object.assign(globals, _.cloneDeep(value.globals)); }
      if (value.metadata) { for (const key of Object.keys(metadata)) delete metadata[key]; Object.assign(metadata, _.cloneDeep(value.metadata)); metadata.variables ??= {}; }
      if (value.variables) { chat[current].variables[chat[current].swipe_id] = _.cloneDeep(value.variables); state.variables = chat[current].variables[chat[current].swipe_id]; }
      primitives.precacheVariables(current);
    },
    refreshWorldInfo: async () => { delete persisted.preloadSignature; await initialize(); },
    parseJSON: primitives.parseJSON, jsonPatch: primitives.jsonPatch, primitives, effects,
    dispose() { compileCache.clear(); } };
}
