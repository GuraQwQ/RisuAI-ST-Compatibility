import { createRegexEngine } from './vendor/regex.mjs';
import { createWorldEngine } from './vendor/world-info.mjs';

/** 每次求值独立作用域，预览与取消丢弃副本，不写回聊天。 */
export function createRuntime({ card, settings = {}, metadata = {}, user = 'User',
  globalRegex = [], presetRegex = [], books = {}, countTokens, substitute, random,
  events = async () => {}, extensionPrompts = {}, trace = [] }) {
  if (typeof countTokens !== 'function') throw new TypeError('必须提供宿主 tokenizer');
  const data = card.data ?? card;
  const localMetadata = structuredClone(metadata);
  const console = Object.fromEntries(['debug', 'log', 'warn', 'error'].map(level => [level,
    (...args) => trace.push({ level, text: args.filter(arg => typeof arg === 'string').join(' ') })]));
  const substituteParams = substitute ?? ((value, overrides = {}, transform = value => value) =>
    String(value).replace(/{{(char|user)}}/gi, (_, name) => transform(
      name.toLowerCase() === 'char' ? overrides.name2Override ?? data.name : user)));
  const extension_settings = { disabledExtensions: [], note: { allowWIScan: false } };
  const regex = createRegexEngine({
    getRegexScripts: () => [...globalRegex, ...presetRegex, ...(data.extensions?.regex_scripts ?? [])],
    substituteParams,
    substituteParamsExtended: substituteParams,
    extension_settings, console,
  });
  let characterEntries = [];
  const world = createWorldEngine({
    settings, chat_metadata: localMetadata, console, random,
    getContext: () => ({ extensionPrompts, tagMap: books.tagMap ?? {}, setExtensionPrompt: (...args) => events('setExtensionPrompt', args) }),
    getExtensionPromptByName: async name => extensionPrompts[name]?.value ?? '',
    getTokenCountAsync: async text => {
      const count = await countTokens(text);
      if (!Number.isFinite(count) || count < 0) throw new TypeError('宿主 tokenizer 必须返回非负有限数量');
      return count;
    },
    getCharacterLore: async () => [...characterEntries, ...(books.character ?? [])],
    getGlobalLore: async () => books.global ?? [],
    getChatLore: async () => books.chat ?? [],
    getPersonaLore: async () => books.persona ?? [],
    eventSource: { emit: events },
    event_types: { WORLDINFO_ENTRIES_LOADED: 'worldinfo_entries_loaded', WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    substituteParams, ...regex,
    getCharaFilename: () => data.name,
    getTagKeyForEntity: () => data.name,
    this_chid: 0, shouldWIAddPrompt: false, NOTE_MODULE_NAME: '2_floating_prompt', metadata_keys: {},
    extension_settings,
    toastr: { warning: text => console.warn(text) },
    GENERATION_TYPE_TRIGGERS: ['normal', 'continue', 'swipe', 'regenerate', 'quiet', 'impersonate'],
    extension_prompt_roles: { SYSTEM: 0, USER: 1, ASSISTANT: 2 },
  });
  if (data.character_book) characterEntries = Object.values(world.convertCharacterBook(structuredClone(data.character_book)).entries)
    .map(entry => ({ ...entry, world: `card:${data.name}` }));
  return { ...regex, ...world, metadata: localMetadata, trace, substituteParams };
}
