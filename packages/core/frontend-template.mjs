import { createTemplateSession } from './template.mjs';

/** 函数与执行上下文留在 iframe，数据库只接收可持久化的模板副作用。 */
export function createFrontendTemplate(getView, api, enqueue, flush, call) {
  const clone = value => value === undefined ? undefined : structuredClone(value);
  let session, ready, identity, observedSnapshot, worldSignature = '';
  const preparedContexts = new WeakSet();
  const currentVariables = () => getView().messages?.length
    ? api.getVariables({ type: 'message', message_id: getView().currentMessageId ?? -1 }) : {};
  const ensure = () => {
    const view = getView(), source = view.templateSnapshot ?? {};
    if (observedSnapshot !== source) {
      observedSnapshot = source;
      worldSignature = JSON.stringify([source.worldbooks, source.worldbookBindings, source.card]);
    }
    const nextIdentity = JSON.stringify([view.chatId, view.currentMessageId, worldSignature]);
    if (session && identity === nextIdentity) { if (view.templateState?.features) session.setFeatures(view.templateState.features); return session; }
    session?.dispose(); identity = nextIdentity;
    const snapshot = clone(source);
    snapshot.card ??= { data: { name: view.name ?? '', extensions: {} } };
    snapshot.user ??= view.user;
    snapshot.chat ??= { id: view.chatId, message: [], stCompatibility: { greetingMaterialized: true } };
    const offset = Number(!snapshot.chat.stCompatibility?.greetingMaterialized);
    snapshot.chat.message = (view.messages ?? []).slice(offset).map(message => ({
      ...snapshot.chat.message.find(item => item.chatId === message.storage_id),
      chatId: message.storage_id, data: message.message ?? '', role: message.role === 'assistant' ? 'char' : message.role,
      name: message.name, stCompatibility: { role: message.role, state: { variables: clone(message.data ?? {}) },
        swipes: { current: message.swipe_id ?? 0, data: clone(message.swipes_data ?? [message.data ?? {}]) } },
    }));
    if (offset && view.messages?.[0]) {
      snapshot.greeting = view.messages[0].message;
      snapshot.chat.stCompatibility ??= {};
      snapshot.chat.stCompatibility.greetingVariables = clone(view.messages[0].swipes_data ?? [view.messages[0].data ?? {}]);
      snapshot.chat.stCompatibility.greetingSwipe = view.messages[0].swipe_id ?? 0;
    }
    const state = { variables: clone(currentVariables()), globals: clone(api.getVariables({ type: 'global' })),
      metadata: clone(view.templateMetadata ?? source.state?.metadata ?? {}),
      template: clone(view.templateState ?? source.state?.template ?? {}) };
    session = createTemplateSession(snapshot, state, { phase: 'render', messageId: view.currentMessageId,
      substitute: text => api.substitudeMacros(text),
      regex: (text, placement, options = {}) => api.formatAsTavernRegexedString(text,
        ({ 1: 'user_input', 2: 'ai_output', 3: 'slash_command', 5: 'world_info', 6: 'reasoning' })[placement] ?? 'world_info',
        options.isMarkdown ? 'display' : 'prompt', options),
      host: { execute: command => api.triggerSlash(command), $: globalThis.$,
        SillyTavern: api.SillyTavern, notify: (level, message) => globalThis.toastr?.[level]?.(message) } });
    ready = session.initialize();
    ready.catch(() => {});
    return session;
  };
  const prepare = async () => {
    await flush();
    const active = ensure(); await ready;
    const view = getView();
    active.syncState({ variables: currentVariables(), globals: api.getVariables({ type: 'global' }),
      metadata: view.templateMetadata ?? view.templateSnapshot?.state?.metadata ?? {} });
    return active;
  };
  const save = async active => {
    const effects = active.effects(), view = getView();
    view.templateState = clone(effects.templateState);
    view.templateMetadata = clone(effects.metadata);
    view.scopes ??= {}; view.scopes.global = clone(effects.globals);
    const offset = Number(!view.templateSnapshot?.chat?.stCompatibility?.greetingMaterialized);
    for (const change of effects.messageVariables) {
      const message = change.storageId ? view.messages?.find(item => item.storage_id === change.storageId)
        : view.messages?.[change.index + offset];
      if (!message) continue;
      message.swipes_data = clone(change.variables);
      message.data = clone(change.variables[change.swipeId ?? 0] ?? {});
    }
    await enqueue(() => call('templateEffects', effects));
    await flush();
  };
  const facade = {
    async prepareContext(additional = {}, end = getView().currentMessageId ?? -1) {
      const context = await (await prepare()).prepareContext(additional, end);
      preparedContexts.add(context); return context;
    },
    async evalTemplate(code, context = null, options = {}) {
      let active;
      if (context && preparedContexts.has(context)) { await flush(); active = ensure(); await ready; }
      else active = await prepare();
      const value = await active.evalTemplate(code, context ?? await active.prepareContext(), options);
      await save(active); return value;
    },
    async compileTemplate(code, options = {}, thisData = {}) {
      const active = await prepare(), compiled = active.compileTemplate(code, options, thisData);
      return async function (context = thisData) {
        const value = await compiled.call(this, context);
        await save(active); return value;
      };
    },
    allVariables(end) { return clone(ensure().allVariables(end)); },
    getFeatures: () => ensure().getFeatures(),
    setFeatures(features) { const active = ensure(); active.setFeatures(features); return save(active); },
    resetFeatures() { const active = ensure(); active.resetFeatures(); return save(active); },
    getSyntaxErrorInfo: (code, count) => ensure().getSyntaxErrorInfo(code, count),
    async saveVariables() { await flush(); const active = ensure(); await ready; await active.saveVariables(true); await save(active); },
    async refreshWorldInfo() { const active = await prepare(); await active.refreshWorldInfo(); await save(active); },
    parseJSON: text => ensure().parseJSON(text),
    jsonPatch: (value, patch) => ensure().jsonPatch(value, patch),
    get defines() { return ensure().defines; },
    get initialVariables() { return ensure().initialVariables; },
  };
  return facade;
}
