import lodash from 'lodash';
import { createFrontendResources } from './frontend-resources.mjs';
import { iframeEvents, tavernEvents } from './frontend-events.mjs';

/** 同步接口使用挂载快照；写操作先更新本地视图，再按调用顺序提交宿主。 */
export function createFrontendApi(initial, call, notify = () => {}, environment = { _: lodash }) {
  let view = structuredClone(initial);
  let queue = Promise.resolve();
  let eventQueue = Promise.resolve();
  let failure;
  let pendingWrites = 0;
  let dispatchingEvents = false;
  const pendingMvuEvents = new WeakMap();
  const listeners = new Map();
  const onceListeners = new Map();
  const generations = environment.generations ?? new Map();
  const ownGenerations = new Set();
  const injections = environment.injections ?? new Map();
  const macroLikes = new Map();
  const variableSchemas = new Map();
  let disposed = false;
  const globals = environment.globals ?? { values: new Map(), owners: new Map(), waiting: new Map() };
  const sharedNames = new Set();
  const clone = value => structuredClone(value);
  const indexOf = value => {
    const count = view.messages.length;
    const parsed = value === undefined || value === 'latest' ? count - 1 : Number(value);
    const index = parsed < 0 ? count + parsed : parsed;
    if (!Number.isInteger(index) || index < 0 || index >= count) throw new RangeError(`消息楼层不存在：${value}`);
    return index;
  };
  const storageId = message => String(message.storage_id ?? message.message_id);
  const scopeOf = (option = {}) => {
    const type = option.type ?? 'chat';
    if (type === 'message') {
      const message = view.messages[indexOf(option.message_id)];
      return `message:${storageId(message)}:${message.swipe_id ?? 0}`;
    }
    if (type === 'script') return `script:${option.script_id ?? view.scriptId}`;
    if (type === 'extension') return 'extension:' + (option.extension_id ?? view.extensionId);
    if (!['global', 'preset', 'character', 'chat'].includes(type)) throw new Error(`未知变量作用域：${type}`);
    return type;
  };
  const messageIndex = id => view.messages.findIndex(message => storageId(message) === id);
  const messageScope = scope => scope.match(/^message:(.*):(\d+)$/);
  const read = scope => {
    const match = messageScope(scope);
    if (!match) {
      const nested = scope.match(/^(script|extension):(.*)$/);
      return nested ? view.scopes[nested[1]]?.[nested[2]] ?? {} : view.scopes[scope] ?? {};
    }
    const message = view.messages[messageIndex(match[1])];
    return message?.swipes_data?.[Number(match[2])] ?? message?.data ?? {};
  };
  const assign = (scope, value) => {
    const match = messageScope(scope);
    if (match) {
      const message = view.messages[messageIndex(match[1])];
      if (message.swipes_data) message.swipes_data[Number(match[2])] = clone(value);
      else message.data = clone(value);
    }
    else {
      const nested = scope.match(/^(script|extension):(.*)$/);
      if (nested) {
        view.scopes[nested[1]] ??= {};
        view.scopes[nested[1]][nested[2]] = clone(value);
      } else view.scopes[scope] = clone(value);
    }
  };
  const enqueue = task => {
    pendingWrites++;
    const committed = queue.then(async () => {
      if (failure) throw failure;
      return task();
    });
    queue = committed.catch(error => { failure = error; notify('error', String(error)); }).finally(() => { pendingWrites--; });
    return committed;
  };
  const schedule = operation => {
    const committed = enqueue(() => call('commit', operation));
    if (operation.events?.length) eventQueue = eventQueue.then(() => committed).then(async () => {
      dispatchingEvents = true;
      try { for (const event of operation.events) await emitLocal(event.name, ...event.args); }
      finally { dispatchingEvents = false; }
    }).catch(error => notify('error', String(error)));
  };
  const flush = async () => { await queue; if (!dispatchingEvents) await eventQueue; if (failure) throw failure; };
  const getVariables = (option = {}) => clone(read(scopeOf(option)));
  const replaceVariables = (variables, option = {}) => {
    if (!variables || typeof variables !== 'object' || Array.isArray(variables)) throw new TypeError('变量表必须是对象');
    const scope = scopeOf(option);
    const before = clone(read(scope));
    assign(scope, variables);
    const events = pendingMvuEvents.get(variables) ?? [];
    pendingMvuEvents.delete(variables);
    schedule({ kind: 'variables', scope, before, after: clone(variables), events });
  };
  const updateVariablesWith = (callback, option = {}) => {
    const result = callback(getVariables(option));
    const apply = variables => { replaceVariables(variables, option); return clone(variables); };
    return result?.then ? result.then(apply) : apply(result);
  };
  const getChatMessages = (range, options = {}) => {
    if (!view.messages.length) return [];
    const text = api.substitudeMacros(String(range ?? -1));
    const match = text.match(/^(-?\d+)(?:-(-?\d+))?$/);
    if (!match) return [];
    const clamp = value => Math.max(0, Math.min(view.messages.length - 1, Number(value) < 0
      ? view.messages.length + Number(value) : Number(value)));
    const [start, end] = [clamp(match[1]), clamp(match[2] ?? match[1])].sort((a, b) => a - b);
    return clone(view.messages.slice(start, end + 1).filter(message =>
      (!options.role || options.role === 'all' || message.role === options.role) &&
      (!options.hide_state || options.hide_state === 'all' || message.is_hidden === (options.hide_state === 'hidden')))
      .map(message => {
        const swipes = message.swipes ?? [message.message ?? ''];
        const data = swipes.map((_, index) => message.swipes_data?.[index] ?? message.data ?? {});
        const info = swipes.map((_, index) => message.swipes_info?.[index] ?? message.extra ?? {});
        const swipe = message.swipe_id ?? 0;
        return options.include_swipes ? { message_id: message.message_id, name: message.name ?? (message.role === 'user' ? view.user : view.name),
          role: message.role, is_hidden: !!message.is_hidden, swipe_id: swipe, swipes, swipes_data: data, swipes_info: info }
          : { ...message, name: message.name ?? (message.role === 'user' ? view.user : view.name),
            message: swipes[swipe] ?? message.message ?? '', data: data[swipe] ?? {}, extra: info[swipe] ?? {} };
      }));
  };
  const setChatMessages = async (changes, { refresh = 'affected' } = {}) => {
    if (!['none', 'affected', 'all'].includes(refresh)) throw new Error(`未知消息刷新方式：${refresh}`);
    const merged = new Map();
    for (const value of changes) {
      const parsed = Number(value.message_id);
      const index = parsed < 0 ? view.messages.length + parsed : parsed;
      if (!Number.isInteger(index) || index < 0 || index >= view.messages.length) continue;
      merged.set(index, { ...merged.get(index), ...clone(value), message_id: index });
    }
    for (const [index, change] of [...merged].sort(([a], [b]) => a - b)) {
      const before = clone(view.messages[index]);
      const after = { ...before, ...clone(change), message_id: before.message_id };
      if (change.message === undefined && change.data === undefined && ['swipe_id', 'swipes', 'swipes_data', 'swipes_info'].some(key => change[key] !== undefined)) {
        const length = Math.max(change.swipes?.length ?? 0, change.swipes_data?.length ?? 0, change.swipes_info?.length ?? 0, 1);
        after.swipe_id = Math.max(0, Math.min(length - 1, change.swipe_id ?? before.swipe_id ?? 0));
        for (const [key, fallback] of [['swipes', ''], ['swipes_data', {}], ['swipes_info', {}]]) {
          after[key] = Array.from({ length }, (_, i) => (change[key] ?? before[key])?.[i] ?? clone(fallback));
          change[key] = clone(after[key]);
        }
        change.swipe_id = after.swipe_id;
        after.message = after.swipes[after.swipe_id]; after.data = after.swipes_data[after.swipe_id]; after.extra = after.swipes_info[after.swipe_id];
      } else {
        const swipe = before.swipe_id ?? 0;
        if (change.message !== undefined && after.swipes) after.swipes[swipe] = change.message;
        if (change.data !== undefined && after.swipes_data) after.swipes_data[swipe] = clone(change.data);
        if (change.extra !== undefined && after.swipes_info) after.swipes_info[swipe] = clone(change.extra);
      }
      view.messages[index] = after;
      schedule({ kind: 'message', messageId: before.storage_id == null
        ? (before.message_id === 0 ? null : `legacy:${index}`) : before.storage_id, before, after: clone(change), refresh });
    }
    await flush();
    for (const [index] of merged) {
      await emitLocal('message_updated', index);
      if (refresh === 'affected') await emitLocal(view.messages[index].role === 'user' ? 'user_message_rendered' : 'character_message_rendered', index);
    }
    if (refresh === 'all') await emitLocal('chat_id_changed', view.chatId);
  };
  const localStorage = {
    get length() { return Object.keys(view.localStorage ?? {}).length; },
    key: index => Object.keys(view.localStorage ?? {})[index] ?? null,
    getItem: key => Object.hasOwn(view.localStorage ?? {}, String(key)) ? String(view.localStorage[String(key)]) : null,
    setItem(key, value) {
      key = String(key); value = String(value);
      const oldValue = localStorage.getItem(key);
      if (oldValue === value) return;
      view.localStorage ??= {};
      view.localStorage[key] = value;
      schedule({ kind: 'storage', operation: 'set', key, value, oldValue });
    },
    removeItem(key) {
      key = String(key);
      if (!Object.hasOwn(view.localStorage ?? {}, key)) return;
      const oldValue = view.localStorage[key];
      delete view.localStorage[key];
      schedule({ kind: 'storage', operation: 'remove', key, oldValue });
    },
    clear() {
      if (!Object.keys(view.localStorage ?? {}).length) return;
      view.localStorage = {};
      schedule({ kind: 'storage', operation: 'clear' });
    },
  };
  const eventOn = (name, callback) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(callback);
    return { stop: () => listeners.get(name)?.delete(callback) };
  };
  const eventRemoveListener = (name, callback) => {
    const wrappers = onceListeners.get(name);
    const wrapper = wrappers?.get(callback) ?? callback;
    listeners.get(name)?.delete(wrapper);
    wrappers?.delete(callback);
    if (wrappers) for (const [original, value] of wrappers) if (value === callback) wrappers.delete(original);
  };
  const emitLocal = async (name, ...args) => {
    for (const callback of [...(listeners.get(name) ?? [])]) await callback(...args);
  };
  const eventEmit = async (name, ...args) => { await flush(); await emitLocal(name, ...args); return call('event', { name, args }); };
  const eventOnce = (name, callback) => {
    if (listeners.get(name)?.has(callback) || onceListeners.get(name)?.has(callback)) return { stop: () => eventRemoveListener(name, callback) };
    const wrapper = (...args) => { eventRemoveListener(name, wrapper); return callback(...args); };
    if (!onceListeners.has(name)) onceListeners.set(name, new Map());
    onceListeners.get(name).set(callback, wrapper);
    eventOn(name, wrapper);
    return { stop: () => { eventRemoveListener(name, wrapper); onceListeners.get(name)?.delete(callback); } };
  };
  const events = environment.iframeEvents ?? iframeEvents;
  const encodeImage = async value => {
    if (Array.isArray(value)) return Promise.all(value.map(encodeImage));
    if (typeof Blob === 'undefined' || !(value instanceof Blob)) return value;
    const bytes = new Uint8Array(await value.arrayBuffer());
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
    return `data:${value.type || 'application/octet-stream'};base64,${btoa(binary)}`;
  };
  const runGeneration = async (method, supplied = {}) => {
    if (disposed) throw new Error('前端已卸载');
    const config = { ...supplied, generation_id: supplied.generation_id ?? globalThis.crypto.randomUUID() };
    if (generations.has(config.generation_id)) throw new Error(`生成标识正在使用：${config.generation_id}`);
    let cancel, stopped = false;
    const cancelled = new Promise((_, reject) => { cancel = () => { stopped = true; reject(Object.assign(new Error('生成已取消'), { name: 'AbortError' })); }; });
    cancelled.catch(() => {});
    const id = config.generation_id;
    generations.set(id, cancel); ownGenerations.add(id);
    try {
      await emitLocal(events.GENERATION_REQUESTED, config.generation_id, method, config);
      await flush();
      if (stopped) return await cancelled;
      config.generation_id = id;
      if (config.image !== undefined) config.image = await encodeImage(config.image);
      for (const prompt of config.ordered_prompts ?? []) if (typeof prompt === 'object' && prompt.image !== undefined) prompt.image = await encodeImage(prompt.image);
      for (const prompt of config.overrides?.chat_history?.prompts ?? []) if (prompt.image !== undefined) prompt.image = await encodeImage(prompt.image);
      if (stopped) return await cancelled;
      await emitLocal(events.GENERATION_STARTED, config.generation_id);
      const result = await Promise.race([call(method, config), cancelled]);
      await emitLocal(events.GENERATION_ENDED, typeof result === 'string' ? result : result.content, config.generation_id);
      return result;
    } finally { generations.delete(id); ownGenerations.delete(id); }
  };
  const generate = config => runGeneration('generate', config);
  const Mvu = { getMvuData: getVariables, replaceMvuData: replaceVariables,
    events: { VARIABLE_INITIALIZED: 'mag_variable_initialized', VARIABLE_UPDATE_STARTED: 'mag_variable_update_started',
      VARIABLE_UPDATED: 'mag_variable_updated', VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended' } };
  const parseMessage = async (text, oldData) => {
    await flush();
    const previous = clone(oldData ?? getVariables());
    try {
      const parsed = await call('parseMvu', { text, variables: previous });
      const result = parsed?.variables ?? parsed;
      const events = parsed?.events ?? [
        { name: Mvu.events.VARIABLE_UPDATE_STARTED, args: [previous] },
        { name: Mvu.events.VARIABLE_UPDATED, args: [result, previous] },
        { name: Mvu.events.VARIABLE_UPDATE_ENDED, args: [result, previous] },
      ];
      pendingMvuEvents.set(result, events);
      await flush();
      return result;
    } catch (error) {
      throw error;
    }
  };
  Mvu.parseMessage = parseMessage;
  const api = { getCurrentMessageId: () => view.currentMessageId, getLastMessageId: () => view.messages.length - 1,
    getChatMessages, setChatMessages, getVariables, replaceVariables, updateVariablesWith,
    insertOrAssignVariables: (value, option) => updateVariablesWith(current => (environment._ ?? lodash).mergeWith(current, value, (_left, right) => Array.isArray(right) ? right : undefined), option),
    insertVariables: (value, option) => updateVariablesWith(current => (environment._ ?? lodash).mergeWith({}, value, current, (_left, right) => Array.isArray(right) ? right : undefined), option),
    eventOn, eventOnce, eventRemoveListener, eventEmit, iframe_events: events,
    tavern_events: environment.tavernEvents ?? tavernEvents,
    generate, generateRaw: config => runGeneration('generateRaw', config), Mvu,
    localStorage,
    getWorldbook: async name => clone(view.worldbooks?.[name] ?? []),
    replaceWorldbook: async (name, entries) => {
      const before = clone(view.worldbooks?.[name] ?? []);
      view.worldbooks ??= {}; view.worldbooks[name] = clone(entries);
      schedule({ kind: 'worldbook', name, before, after: clone(entries) }); await flush();
    },
    getCharWorldbookNames: () => ({ primary: view.primaryWorldbook, additional: [] }),
    getScriptId: () => view.scriptId,
  };
  const resources = createFrontendResources(() => view, value => { view = { ...view, ...clone(value) }; }, call, flush, enqueue, environment);
  Object.assign(api, resources.api, {
    substitudeMacros(text) {
      let result = String(text).replace(/{{(char|user|lastMessageId|currentMessageId|lastMessage|lastUserMessage|lastCharMessage)}}/gi, (match, name) => {
        const values = { char: view.name, user: view.user, lastmessageid: view.messages.length - 1,
          currentmessageid: view.currentMessageId, lastmessage: view.messages.at(-1)?.message,
          lastusermessage: view.messages.findLast(message => message.role === 'user')?.message,
          lastcharmessage: view.messages.findLast(message => message.role === 'assistant')?.message };
        return String(values[name.toLowerCase()] ?? '');
      });
      for (const { regex, replace } of macroLikes.values()) result = result.replace(regex, (...args) => replace({ message_id: view.currentMessageId,
        role: view.messages[view.currentMessageId]?.role }, ...args));
      return result;
    },
    registerMacroLike(regex, replace) { macroLikes.set(String(regex), { regex, replace }); return { unregister: () => api.unregisterMacroLike(regex) }; },
    unregisterMacroLike: regex => { macroLikes.delete(String(regex)); },
    eventMakeFirst(name, callback) { eventRemoveListener(name, callback); listeners.set(name, new Set([callback, ...listeners.get(name) ?? []])); return { stop: () => eventRemoveListener(name, callback) }; },
    eventMakeLast(name, callback) { eventRemoveListener(name, callback); return eventOn(name, callback); },
    eventOnButton: eventOn,
    eventEmitAndWait: eventEmit,
    eventClearEvent(name) { listeners.delete(name); onceListeners.delete(name); },
    eventClearListener(callback) { for (const name of listeners.keys()) eventRemoveListener(name, callback); },
    eventClearAll() { listeners.clear(); onceListeners.clear(); },
    deleteVariable(path, option) {
      let delete_occurred;
      const variables = updateVariablesWith(value => { delete_occurred = (environment._ ?? lodash).unset(value, path); return value; }, option);
      return { variables, delete_occurred };
    },
    getAllVariables: () => Object.assign({}, read('global'), read('character'), ...(view.scriptOnly ? [read(`script:${view.scriptId}`)] : []), read('chat'),
      ...(!view.scriptOnly ? view.messages.slice(0, (view.currentMessageId ?? view.messages.length - 1) + 1).map(message => message.swipes_data?.[message.swipe_id ?? 0] ?? message.data ?? {}) : [])),
    registerVariableSchema(schema, option = {}) { const type = option.type ?? 'chat'; variableSchemas.set(type, schema); },
    injectPrompts(prompts, options = {}) {
      for (const prompt of prompts) injections.set(`${view.chatId}/${prompt.id}`, { prompt, once: !!options.once, chatId: view.chatId, owner: view.frameChannel });
      return { uninject: () => api.uninjectPrompts(prompts.map(prompt => prompt.id)) };
    },
    uninjectPrompts(ids) { for (const id of ids) injections.delete(`${view.chatId}/${id}`); },
    stopGenerationById(id) { const cancel = generations.get(id); if (!cancel) return false; cancel(); call('stopGeneration', { generation_id: id }).catch(error => notify('error', String(error))); return true; },
    stopAllGeneration() { const ids = [...generations.keys()]; ids.forEach(api.stopGenerationById); return ids.length > 0; },
    initializeGlobal(name, value) {
      globals.values.set(name, value); globals.owners.set(name, view.frameChannel); sharedNames.add(name);
      for (const resolve of globals.waiting.get(name) ?? []) resolve(value);
      globals.waiting.delete(name); environment.exposeGlobal?.(name, value);
    },
    async waitGlobalInitialized(name) {
      await flush();
      const value = name === 'Mvu' ? Mvu : globals.values.has(name) ? globals.values.get(name) : await new Promise(resolve => {
        if (!globals.waiting.has(name)) globals.waiting.set(name, new Set()); globals.waiting.get(name).add(resolve);
      });
      environment.exposeGlobal?.(name, value); return value;
    },
    getIframeName: () => view.scriptOnly ? `TH-script--${view.scriptName}--${view.scriptId}` : `TH-message--${view.currentMessageId}--${view.frameIndex ?? 0}`,
    getMessageId(name) { const match = name.match(/^TH-message--(\d+)--\d+$/); if (!match) throw new Error('不是消息界面标识'); return Number(match[1]); },
    reloadIframe: () => environment.reload?.(),
    errorCatched: fn => function (...args) {
      try { const value = fn.apply(this, args); return value?.catch ? value.catch(error => { notify('error', String(error)); throw error; }) : value; }
      catch (error) { notify('error', String(error)); throw error; }
    },
    placeholder_prompt_default_order: ['world_info_before', 'persona_description', 'char_description', 'char_personality', 'scenario', 'world_info_after', 'dialogue_examples', 'chat_history', 'user_input'],
    retrieveDisplayedMessage: id => environment.retrieveDisplayedMessage?.(id),
    formatAsDisplayedMessage(text, options = {}) {
      const id = options.message_id ?? 'last';
      const message = id === 'last' ? view.messages.at(-1) : id === 'last_user' ? view.messages.findLast(item => item.role === 'user')
        : id === 'last_char' ? view.messages.findLast(item => item.role === 'assistant') : view.messages[indexOf(id)];
      return environment.formatDisplay?.(api.substitudeMacros(text), message, api) ?? api.substitudeMacros(text);
    },
    refreshOneMessage: (id, node) => environment.refreshOneMessage?.(id, node, api),
  });
  api.builtin_prompt_default_order = api.placeholder_prompt_default_order;
  api.EjsTemplate = environment.makeTemplate?.(() => view, api, enqueue, flush, call)
    ?? Object.fromEntries(['evalTemplate', 'allVariables', 'getFeatures', 'setFeatures', 'resetFeatures', 'getSyntaxErrorInfo', 'refreshWorldInfo', 'saveVariables', 'parseJSON', 'jsonPatch'].map(method => [method, (...args) => call('template', { method, args })]));
  api.EjsTemplate.evaltemplate = api.EjsTemplate.evalTemplate;
  let rawChat, rawChatSource;
  const readRawChat = () => {
    if (rawChatSource !== view.messages) {
      rawChatSource = view.messages;
      rawChat = clone(view.messages.map(message => ({ mes: message.message, is_user: message.role === 'user',
        is_system: message.role === 'system', name: message.name, extra: message.extra ?? {},
        variables: message.swipes_data ?? [message.data ?? {}], swipe_id: message.swipe_id ?? 0,
        swipes: message.swipes ?? [message.message ?? ''] })));
    }
    return rawChat;
  };
  const saveRawChat = async () => {
    if (rawChat) {
      const changes = rawChat.flatMap((message, index) => {
        const before = view.messages[index]; if (!before) return [];
        const data = message.variables?.[message.swipe_id ?? 0] ?? {};
        return message.mes === before.message && JSON.stringify(data) === JSON.stringify(before.swipes_data?.[before.swipe_id ?? 0] ?? before.data ?? {})
          && JSON.stringify(message.extra) === JSON.stringify(before.extra ?? {}) ? []
          : [{ message_id: index, message: message.mes, data, extra: message.extra, swipes_data: message.variables }];
      });
      if (changes.length) await setChatMessages(changes);
    }
    await flush();
  };
  const saveMetadata = async () => { schedule({ kind: 'metadata', after: clone(view.templateMetadata ?? {}) }); await flush(); };
  const context = () => ({ chat: readRawChat(),
    chatMetadata: view.templateMetadata ??= {}, name1: view.user, name2: view.name,
    getCurrentChatId: () => view.chatId, eventSource: { on: eventOn, once: eventOnce, emit: eventEmit, removeListener: eventRemoveListener },
    eventTypes: api.tavern_events, executeSlashCommandsWithOptions: async command => ({ pipe: await api.triggerSlash(command) }),
    saveChat: saveRawChat, saveMetadata });
  api.SillyTavern = { getContext: context, getCurrentChatId: () => view.chatId,
    saveChat: saveRawChat, saveMetadata, saveMetadataDebounced: saveMetadata,
    saveSettingsDebounced: () => resources.deferred('saveExtensionSettings', [view.tavern?.extensionSettings ?? {}]),
    getCurrentLocale: () => 'zh-CN', getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    getChatCompletionModel: () => view.templateSnapshot?.model ?? '',
    getCharacterCardFields: () => clone(view.templateSnapshot?.card?.data ?? view.templateSnapshot?.card ?? {}),
    loadWorldInfo: async name => ({ entries: Object.fromEntries((await api.getLorebookEntries(name)).map(entry => [entry.uid, entry])) }),
    registerMacro(name, value) { return api.registerMacroLike(new RegExp(`{{${String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}}}`, 'gi'), () => typeof value === 'function' ? value() : String(value)); },
    unregisterMacro: name => { for (const [key, value] of macroLikes) if (value.regex.source.includes(String(name))) macroLikes.delete(key); },
  };
  for (const [key, get] of Object.entries({ chat: readRawChat, chatMetadata: () => view.templateMetadata ??= {},
    characters: () => (view.tavern?.characters ?? []).map(item => item.raw), characterId: () => (view.tavern?.characters ?? []).findIndex(item => item.id === view.tavern?.currentCharacterId),
    extensionSettings: () => { view.tavern ??= {}; return view.tavern.extensionSettings ??= {}; },
    chatCompletionSettings: () => view.templateSnapshot?.preset ?? {}, name1: () => view.user, name2: () => view.name,
    eventSource: () => context().eventSource, eventTypes: () => api.tavern_events })) Object.defineProperty(api.SillyTavern, key, { enumerable: true, get });
  api.TavernHelper = api;
  return { api, flush,
    async receive(message) {
      if (message.event && (!view.frameChannel || message.event.origin !== view.frameChannel)) {
        if (message.event.name === 'st_local_storage_changed') {
          const [operation] = message.event.args;
          if (operation.operation === 'set') { view.localStorage ??= {}; view.localStorage[operation.key] = operation.value; }
          else if (operation.operation === 'remove') delete view.localStorage?.[operation.key];
          else if (operation.operation === 'clear') view.localStorage = {};
        }
        return emitLocal(message.event.name, ...message.event.args);
      }
      if (message.view && !pendingWrites) view = clone(message.view);
    }, dispose() {
      disposed = true;
      for (const id of ownGenerations) api.stopGenerationById(id);
      for (const [id, injection] of injections) if (injection.owner === view.frameChannel) injections.delete(id);
      for (const name of sharedNames) if (globals.owners.get(name) === view.frameChannel) { globals.values.delete(name); globals.owners.delete(name); }
      listeners.clear(); onceListeners.clear(); macroLikes.clear();
    } };
}
