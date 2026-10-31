export function normalizeScriptTrees(trees) {
  if (!Array.isArray(trees)) throw new TypeError('脚本列表必须是数组');
  return trees.map(tree => {
    const base = { type: tree.type ?? 'script', enabled: tree.enabled ?? false, name: String(tree.name ?? ''), id: String(tree.id ?? crypto.randomUUID()) };
    if (base.type === 'folder') return { ...base, icon: tree.icon ?? 'fa-solid fa-folder', color: tree.color ?? '',
      scripts: normalizeScriptTrees(tree.scripts ?? []) };
    if (base.type !== 'script') throw new TypeError(`脚本类型无效：${base.type}`);
    return { ...base, content: String(tree.content ?? ''), info: String(tree.info ?? ''), data: structuredClone(tree.data ?? {}),
      button: { enabled: tree.button?.enabled ?? true, buttons: (tree.button?.buttons ?? []).map(button => ({ name: String(button.name), visible: !!button.visible })) },
      export_with: { data: tree.export_with?.data ?? true, button: tree.export_with?.button ?? true } };
  });
}

/** 同步读使用宿主快照；函数型更新器留在 iframe，实际写入统一交给宿主。 */
export function createFrontendResources(getView, applyView, call, flush, enqueue, environment = {}) {
  const clone = value => structuredClone(value);
  const state = () => getView().tavern ?? {};
  const context = () => {
    const view = getView();
    return { characterId: view.characterId, chatId: view.chatId, messageId: view.currentMessageId,
      scriptId: view.scriptId, extensionId: view.extensionId, frameChannel: view.frameChannel };
  };
  const raw = (method, args) => call('tavern', { method, args, context: context() });
  const refresh = async () => {
    const next = await raw('getFrontendState', []);
    if (next && typeof next === 'object') applyView(next.messages ? next : { tavern: next.tavern ?? next });
  };
  const rpc = async (method, args, writes = false) => {
    await flush();
    const result = await raw(method, args);
    if (writes) await refresh();
    return result;
  };
  const deferred = (method, args, update) => {
    update?.();
    enqueue(async () => { await raw(method, args); await refresh(); });
  };
  const response = value => value instanceof Response ? value : new Response(value.base64
    ? Uint8Array.from(atob(value.body), character => character.charCodeAt(0)) : value.body ?? null,
    { status: value.status ?? 200, statusText: value.statusText ?? '', headers: value.headers ?? {} });
  const lookup = (items, name, currentId) => items.find(item => item.id === (name === 'current' ? currentId : name)
    || name !== 'current' && item.name === name);
  const character = name => lookup(state().characters ?? [], name ?? 'current', state().currentCharacterId ?? getView().characterId);
  const persona = name => lookup(state().personas ?? [], name ?? 'current', state().currentPersonaId);
  const required = (value, label) => { if (value === undefined || value === null) throw new Error(`${label}不存在`); return value; };
  const optionsType = option => option?.type ?? option?.scope ?? 'character';
  const regexes = option => {
    const type = optionsType(option);
    if (type === 'global') return clone(state().tavernRegexes?.global ?? []);
    if (type === 'preset') return clone(api.getPreset(option?.name ?? 'in_use').extensions?.regex_scripts ?? []);
    const item = character(option?.name);
    return clone(item?.data?.extensions?.regex_scripts ?? state().tavernRegexes?.character ?? []);
  };
  const update = async (read, write, updater) => {
    const value = await updater(await read());
    await write(value);
    return read();
  };
  const scriptTrees = option => clone(state().scriptTrees?.[optionsType(option)] ?? []);
  const scripts = () => Object.values(state().scriptTrees ?? {}).flatMap(trees => trees.flatMap(tree =>
    tree.type === 'folder' ? (tree.enabled ? tree.scripts : []) : [tree])).filter(script => script.enabled);
  const currentScript = () => required(scripts().find(script => script.id === getView().scriptId), '当前脚本');
  const api = {
    getWorldbookNames: () => Object.keys(state().worldbooks ?? getView().worldbooks ?? {}),
    getGlobalWorldbookNames: () => clone(state().globalWorldbookNames ?? []),
    getCharWorldbookNames: (name = 'current') => {
      const item = character(name);
      if (name !== 'current' && !item) throw new Error(`角色不存在：${name}`);
      return clone(state().charWorldbooks?.[item?.id ?? getView().characterId]
        ?? { primary: getView().primaryWorldbook ?? null, additional: [] });
    },
    getChatWorldbookName: () => state().chatWorldbookName ?? null,
    getWorldbook: name => rpc('getWorldbook', [name]),
    replaceWorldbook: (name, entries, option) => rpc('replaceWorldbook', [name, entries, option], true),
    updateWorldbookWith: (name, updater, option) => update(() => api.getWorldbook(name),
      entries => api.replaceWorldbook(name, entries, option), updater),
    deleteWorldbookEntries: async (name, predicate, option) => {
      const entries = await api.getWorldbook(name);
      const ids = entries.filter(predicate).map(entry => entry.uid);
      return rpc('deleteWorldbookEntries', [name, ids, option], true);
    },
    getCharacterNames: () => (state().characters ?? []).map(item => item.name),
    getCharacterIds: () => (state().characters ?? []).map(item => item.id),
    getCurrentCharacterName: () => character('current')?.name ?? getView().name ?? null,
    getCurrentCharacterId: () => state().currentCharacterId ?? getView().characterId ?? null,
    getCharacter: name => rpc('getCharacter', [name]),
    updateCharacterWith: (name, updater, option) => update(() => api.getCharacter(name),
      value => api.replaceCharacter(name, value, option), updater),
    getPersonaNames: () => (state().personas ?? []).map(item => item.name),
    getPersonaIds: () => (state().personas ?? []).map(item => item.id),
    getCurrentPersonaName: () => persona('current')?.name ?? getView().user ?? null,
    getCurrentPersonaId: () => state().currentPersonaId ?? null,
    getPersonaAvatarPath: (name = 'current') => persona(name)?.avatarPath ?? null,
    getPersona: name => clone(required(persona(name)?.data, `玩家角色 ${name}`)),
    updatePersonaWith: (name, updater, option) => update(() => api.getPersona(name),
      value => api.replacePersona(name, value, option), updater),
    getPresetNames: () => Object.keys(state().presets ?? {}),
    getLoadedPresetName: () => state().loadedPresetName ?? '',
    getPreset: (name = 'in_use') => clone(required(state().presets?.[name], `预设 ${name}`)),
    loadPreset: name => {
      if (name === 'in_use' || !Object.hasOwn(state().presets ?? {}, name)) return false;
      deferred('loadPreset', [name], () => { state().loadedPresetName = name; state().presets.in_use = clone(state().presets[name]); });
      return true;
    },
    updatePresetWith: (name, updater, option) => update(() => api.getPreset(name),
      value => api.replacePreset(name, value, option), updater),
    isPresetSystemPrompt: prompt => ['main', 'nsfw', 'jailbreak', 'enhanceDefinitions'].includes(prompt.id),
    isPresetPlaceholderPrompt: prompt => ['worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality',
      'scenario', 'worldInfoAfter', 'dialogueExamples', 'chatHistory'].includes(prompt.id),
    isPresetNormalPrompt: prompt => !api.isPresetSystemPrompt(prompt) && !api.isPresetPlaceholderPrompt(prompt),
    getTavernRegexes: regexes,
    isCharacterTavernRegexesEnabled: () => state().characterTavernRegexesEnabled !== false,
    updateTavernRegexesWith: (updater, option) => update(() => regexes(option),
      value => api.replaceTavernRegexes(value, option), updater),
    formatAsTavernRegexedString: (text, source, destination, option = {}) => {
      if (!environment.formatRegex) throw new Error('酒馆正则运行库尚未加载');
      return environment.formatRegex(text, source, destination, option, api);
    },
    getScriptTrees: scriptTrees,
    replaceScriptTrees: (trees, option) => { trees = normalizeScriptTrees(trees); deferred('replaceScriptTrees', [trees, option], () => {
      const view = getView(); view.tavern ??= {}; view.tavern.scriptTrees ??= {};
      view.tavern.scriptTrees[optionsType(option)] = clone(trees);
    }); },
    updateScriptTreesWith: (updater, option) => {
      const apply = value => { api.replaceScriptTrees(value, option); return scriptTrees(option); };
      const value = updater(scriptTrees(option)); return value?.then ? value.then(apply) : apply(value);
    },
    getAllEnabledScriptButtons: () => Object.fromEntries(scripts().filter(script => script.button?.enabled).map(script =>
      [script.id, script.button.buttons.filter(button => button.visible).map(button => ({ button_id: `${script.id}_${button.name}`, button_name: button.name }))])),
    getScriptButtons: () => clone(currentScript().button?.buttons ?? []),
    replaceScriptButtons: buttons => deferred('replaceScriptButtons', [buttons], () => { currentScript().button = { enabled: true, buttons: clone(buttons) }; }),
    updateScriptButtonsWith: updater => {
      const apply = buttons => { api.replaceScriptButtons(buttons); return clone(buttons); };
      const value = updater(api.getScriptButtons()); return value?.then ? value.then(apply) : apply(value);
    },
    appendInexistentScriptButtons: buttons => {
      const old = api.getScriptButtons(); api.replaceScriptButtons([...old, ...buttons.filter(button => !old.some(item => item.name === button.name))]);
    },
    getScriptName: () => currentScript().name,
    getScriptInfo: () => currentScript().info,
    replaceScriptInfo: info => deferred('replaceScriptInfo', [info], () => { currentScript().info = String(info); }),
    getButtonEvent: name => `${getView().scriptId}_${name}`,
    getCharData: (name = 'current') => clone(character(name)?.raw ?? null),
    getCharAvatarPath: (name = 'current') => character(name)?.avatarPath ?? null,
    getProxyPresetNames: () => clone(state().proxyPresetNames ?? []),
    getLorebookSettings: () => clone(state().lorebookSettings ?? {}),
    setLorebookSettings: value => deferred('setLorebookSettings', [value], () => {
      getView().tavern ??= {}; getView().tavern.lorebookSettings = { ...api.getLorebookSettings(), ...clone(value) };
    }),
    getCharLorebooks: ({ name = 'current', type = 'all' } = {}) => {
      const books = api.getCharWorldbookNames(name);
      return { primary: type === 'additional' ? null : books.primary, additional: type === 'primary' ? [] : books.additional };
    },
    getCurrentCharPrimaryLorebook: () => api.getCharWorldbookNames('current').primary,
    setCurrentCharLorebooks: books => api.rebindCharWorldbooks('current', { ...api.getCharWorldbookNames('current'), ...books }),
    getChatLorebook: () => api.getChatWorldbookName('current'),
    getOrCreateChatLorebook: name => api.getOrCreateChatWorldbook('current', name),
    getExtensionType: id => state().extensions?.[id]?.type ?? null,
    isInstalledExtension: id => Object.hasOwn(state().extensions ?? {}, id),
    isAdmin: () => state().isAdmin === true,
    getTavernHelperExtensionId: () => getView().extensionId ?? 'risu-st-compatibility',
    getTavernHelperVersion: () => state().helperVersion ?? '0.4.0',
    getTavernVersion: () => state().tavernVersion ?? '1.19.0',
  };
  for (const name of ['rebindGlobalWorldbooks', 'rebindCharWorldbooks', 'rebindChatWorldbook', 'getOrCreateChatWorldbook',
    'createWorldbook', 'createOrReplaceWorldbook', 'deleteWorldbook', 'createWorldbookEntries',
    'createCharacter', 'createOrReplaceCharacter', 'replaceCharacter', 'deleteCharacter',
    'createPersona', 'createOrReplacePersona', 'replacePersona', 'deletePersona',
    'createPreset', 'createOrReplacePreset', 'replacePreset', 'deletePreset', 'renamePreset', 'setPreset',
    'replaceTavernRegexes', 'createChatMessages', 'deleteChatMessages', 'rotateChatMessages',
    'replaceLorebookEntries', 'setLorebookEntries', 'createLorebookEntries', 'deleteLorebookEntries',
    'setChatLorebook', 'uploadTavernFile', 'deleteTavernFile']) api[name] = (...args) => rpc(name, args, true);
  for (const name of ['getLorebookEntries', 'getChatHistoryBrief', 'getChatHistoryDetail', 'getModelList',
    'triggerSlash', 'getExtensionInstallationInfo']) api[name] = (...args) => rpc(name, args);
  for (const name of ['getTavernFile', 'importRawCharacter', 'importRawChat', 'importRawWorldbook',
    'installExtension', 'uninstallExtension', 'reinstallExtension', 'updateExtension']) {
    api[name] = async (...args) => response(await rpc(name, args, name !== 'getTavernFile'));
  }
  api.importRawPreset = (...args) => rpc('importRawPreset', args, true);
  api.importRawTavernRegex = (filename, content) => {
    JSON.parse(content);
    deferred('importRawTavernRegex', [filename, content]); return true;
  };
  api.updateLorebookEntriesWith = (name, updater) => update(() => api.getLorebookEntries(name),
    value => api.replaceLorebookEntries(name, value), updater);
  api.updatelorebookEntriesWith = api.updateLorebookEntriesWith;
  api.getLorebooks = api.getWorldbookNames;
  api.createLorebook = name => api.createWorldbook(name);
  api.deleteLorebook = api.deleteWorldbook;
  api.getExtensionStatus = api.getExtensionInstallationInfo;
  Object.defineProperty(api, 'default_preset', { enumerable: true, get: () => clone(state().defaultPreset ?? state().presets?.in_use) });
  api.RawCharacter = class RawCharacter {
    constructor(data) { this.data = clone(data); }
    static find({ name = 'current' } = {}) { return api.getCharData(name); }
    static findIndex(name) { return (state().characters ?? []).findIndex(item => item.name === name || item.id === name); }
    static getChatsFromFiles(data, isGroupChat) { return api.getChatHistoryDetail(data, isGroupChat); }
    getCardData() { return clone(this.data); }
    getAvatarId() { return this.data.avatar; }
    getRegexScripts() { return clone(this.data.data?.extensions?.regex_scripts ?? this.data.extensions?.regex_scripts ?? []); }
    getCharacterBook() { return clone(this.data.data?.character_book ?? null); }
    getWorldName() { return this.data.data?.extensions?.world ?? this.data.world ?? ''; }
  };
  return { api, rpc, deferred };
}
