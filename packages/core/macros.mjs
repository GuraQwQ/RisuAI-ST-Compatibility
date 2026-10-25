import { createLegacyMacros } from './vendor/macros.mjs';
import { createModernMacroEngine } from './vendor/modern-macros.mjs';
import { createPromptEngine } from './vendor/prompt.mjs';
import { getStringHash, parseTimestamp } from './vendor/utils.mjs';
import moment from 'moment';

export function createMacros(snapshot, state, diagnostics) {
  const data = snapshot.card.data ?? snapshot.card;
  const metadata = state.metadata ??= {};
  const globals = state.globals ??= {};
  const chat = [{ mes: snapshot.greeting ?? data.first_mes, is_user: false }, ...(snapshot.chat?.message ?? [])
    .map(message => ({ mes: message.data, is_user: message.role === 'user', send_date: message.time }))];
  const log = Object.fromEntries(['log', 'warn', 'debug', 'error'].map(level => [level,
    (...args) => diagnostics.push({ level, text: args.map(arg => typeof arg === 'string' ? arg : arg?.message ?? String(arg)).join(' ') })]));
  const engine = createLegacyMacros({
    chat,
    chat_metadata: metadata, extension_settings: { variables: { global: globals } },
    power_user: { instruct: { enabled: false }, sysprompt: { enabled: true, content: snapshot.systemPrompt ?? '' },
      context: { example_separator: '<START>', chat_start: '' }, experimental_macro_engine: false },
    getCurrentChatId: () => snapshot.chat?.id ?? data.name,
    getMaxPromptTokens: () => (snapshot.maxContext ?? 8192) - (snapshot.maxResponse ?? 0),
    getMaxContextTokens: () => snapshot.maxContext ?? 8192,
    getMaxResponseTokens: () => snapshot.maxResponse ?? 0,
    extension_prompts: snapshot.extensionPrompts ?? {}, input: snapshot.input ?? '',
    console: log,
  });
  const variableScope = (scope, prefix) => ({
    get: engine[`get${prefix}Variable`], set: engine[`set${prefix}Variable`], add: engine[`add${prefix}Variable`],
    inc: engine[`increment${prefix}Variable`], dec: engine[`decrement${prefix}Variable`],
    has: name => Object.hasOwn(scope(), name), del: name => { delete scope()[name]; },
  });
  const modern = snapshot.macroEngine === 'modern' ? createModernMacroEngine({
    chat, metadata, chatId: snapshot.chat?.id ?? data.name, maxContext: snapshot.maxContext, maxResponse: snapshot.maxResponse,
    operation: snapshot.operation, input: snapshot.input, extensionPrompts: snapshot.extensionPrompts, console: log,
    variables: { local: variableScope(() => metadata.variables ?? {}, 'Local'), global: variableScope(() => globals, 'Global') },
    timestampToMoment: value => moment(parseTimestamp(value)),
    parseMesExamples: value => createPromptEngine({}).parseMesExamples(value, false),
  }) : null;
  return (text, overrides = {}, postProcess = value => value) => {
    const values = {
    charPrompt: data.system_prompt ?? '', charInstruction: data.post_history_instructions ?? '',
    description: data.description ?? '', personality: data.personality ?? '', scenario: data.scenario ?? '',
    persona: snapshot.persona ?? '', mesExamplesRaw: data.mes_example ?? '',
    charVersion: data.character_version ?? '', charDepthPrompt: data.extensions?.depth_prompt?.prompt ?? '',
    creatorNotes: data.creator_notes ?? '', user: overrides.name1Override ?? snapshot.user ?? 'User',
    char: overrides.name2Override ?? data.name, group: data.name, charIfNotGroup: data.name,
    notChar: snapshot.user ?? 'User', model: snapshot.model ?? '', lastGenerationType: snapshot.operation ?? 'normal',
    ...(overrides.original !== undefined ? { original: overrides.original } : {}),
    ...overrides.dynamicMacros,
    summary: snapshot.summary ?? '',
    };
    if (!modern) return engine.evaluateMacros(text, values, postProcess);
    let original = overrides.original ?? '';
    return modern.evaluate(text, { content: text, contentHash: getStringHash(text), names: {
      user: values.user, char: values.char, group: values.group, groupNotMuted: values.group, notChar: values.notChar },
    character: { ...values, version: values.charVersion, firstMessage: snapshot.greeting ?? data.first_mes,
      alternateGreetings: data.alternate_greetings ?? [] }, system: { model: values.model },
    functions: { original: () => { const value = original; original = ''; return value; }, postProcess },
    dynamicMacros: { summary: snapshot.summary ?? '', ...Object.fromEntries(Object.entries(overrides.dynamicMacros ?? {}).map(([key, value]) => [key.toLowerCase(), value])) }, extra: {} });
  };
}
