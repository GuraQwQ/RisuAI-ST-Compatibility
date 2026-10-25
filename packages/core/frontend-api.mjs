/** 同步接口使用挂载快照；写操作先更新本地视图，再按调用顺序提交宿主。 */
export function createFrontendApi(initial, call, notify = () => {}) {
  let view = structuredClone(initial);
  let queue = Promise.resolve();
  let eventQueue = Promise.resolve();
  let failure;
  let pendingWrites = 0;
  let dispatchingEvents = false;
  const pendingMvuEvents = new WeakMap();
  const listeners = new Map();
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
  const schedule = operation => {
    pendingWrites++;
    const committed = queue.then(async () => {
      if (failure) throw failure;
      return call('commit', operation);
    });
    queue = committed.catch(error => { failure = error; notify('error', String(error)); }).finally(() => { pendingWrites--; });
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
    let start;
    let end;
    const match = typeof range === 'string' && range.match(/^(-?\d+)-(-?\d+)$/);
    if (match) { start = indexOf(match[1]); end = indexOf(match[2]); }
    else start = end = indexOf(range);
    return clone(view.messages.slice(start, end + 1).filter(message =>
      (!options.role || options.role === 'all' || message.role === options.role) &&
      (!options.hide_state || options.hide_state === 'all' || message.is_hidden === (options.hide_state === 'hidden')))
      .map(message => options.include_swipes ? { ...message, swipe_id: message.swipe_id ?? 0,
        swipes: message.swipes ?? [message.message], swipes_data: message.swipes_data ?? [message.data],
        swipes_info: message.swipes_info ?? [message.extra ?? {}] } : message));
  };
  const setChatMessages = async changes => {
    for (const change of changes) {
      const index = indexOf(change.message_id);
      const before = clone(view.messages[index]);
      const after = { ...before, ...clone(change), message_id: before.message_id };
      view.messages[index] = after;
      schedule({ kind: 'message', messageId: before.storage_id == null
        ? (before.message_id === 0 ? null : `legacy:${index}`) : before.storage_id, before, after: clone(change) });
    }
    await flush();
    for (const change of changes) await emitLocal('message_updated', change.message_id);
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
  const eventRemoveListener = (name, callback) => listeners.get(name)?.delete(callback);
  const emitLocal = async (name, ...args) => {
    for (const callback of [...(listeners.get(name) ?? [])]) await callback(...args);
  };
  const eventEmit = async (name, ...args) => { await flush(); await emitLocal(name, ...args); return call('event', { name, args }); };
  const eventOnce = (name, callback) => {
    const wrapper = (...args) => { eventRemoveListener(name, wrapper); return callback(...args); };
    return eventOn(name, wrapper);
  };
  const events = { GENERATION_REQUESTED: 'js_generation_requested', GENERATION_STARTED: 'js_generation_started',
    GENERATION_ENDED: 'js_generation_ended', STREAM_TOKEN_RECEIVED_FULLY: 'js_stream_token_received_fully',
    STREAM_TOKEN_RECEIVED_INCREMENTALLY: 'js_stream_token_received_incrementally' };
  const generate = async (config = {}) => {
    await emitLocal(events.GENERATION_REQUESTED, config);
    await flush();
    await emitLocal(events.GENERATION_STARTED, config.generation_id);
    const result = await call('generate', config);
    await emitLocal(events.GENERATION_ENDED, result, config.generation_id);
    return result;
  };
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
    insertOrAssignVariables: (value, option) => updateVariablesWith(current => ({ ...current, ...value }), option),
    insertVariables: (value, option) => updateVariablesWith(current => ({ ...value, ...current }), option),
    eventOn, eventOnce, eventRemoveListener, eventEmit, iframe_events: events,
    tavern_events: { MESSAGE_SENT: 'message_sent', MESSAGE_RECEIVED: 'message_received', MESSAGE_UPDATED: 'message_updated', MESSAGE_DELETED: 'message_deleted', MESSAGE_SWIPED: 'message_swiped', CHAT_CHANGED: 'chat_id_changed',
      GENERATION_STARTED: 'generation_started', GENERATION_ENDED: 'generation_ended' },
    generate, generateRaw: async config => { await flush(); return call('generateRaw', config); }, Mvu,
    waitGlobalInitialized: async name => {
      if (name !== 'Mvu') throw new Error(`尚未提供共享运行库：${name}`);
      await flush();
    },
    getWorldbookNames: () => Object.keys(view.worldbooks ?? {}),
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
  api.SillyTavern = { getContext: () => ({ chat: clone(view.messages.map(message => ({ mes: message.message,
    is_user: message.role === 'user', name: message.name, variables: [message.data], swipe_id: message.swipe_id ?? 0 }))),
    chatMetadata: clone(view.scopes.chat ?? {}), name1: view.user, name2: view.name,
    getCurrentChatId: () => view.chatId, eventSource: { on: eventOn, once: eventOnce, emit: eventEmit, removeListener: eventRemoveListener },
    eventTypes: api.tavern_events }), getCurrentChatId: () => view.chatId };
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
    }, dispose() { listeners.clear(); } };
}
