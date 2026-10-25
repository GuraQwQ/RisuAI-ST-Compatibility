import { createLegacyMacros } from './vendor/macros.mjs';

export function createMacros(snapshot, state, diagnostics) {
  const data = snapshot.card.data ?? snapshot.card;
  const metadata = state.metadata ??= {};
  const globals = state.globals ??= {};
  const engine = createLegacyMacros({
    chat: [{ mes: snapshot.greeting ?? data.first_mes, is_user: false }, ...(snapshot.chat?.message ?? [])
      .map(message => ({ mes: message.data, is_user: message.role === 'user', send_date: message.time }))],
    chat_metadata: metadata, extension_settings: { variables: { global: globals } },
    power_user: { instruct: { enabled: false }, sysprompt: { enabled: true, content: snapshot.systemPrompt ?? '' },
      context: { example_separator: '<START>', chat_start: '' }, experimental_macro_engine: false },
    getCurrentChatId: () => snapshot.chat?.id ?? data.name,
    getMaxPromptTokens: () => (snapshot.maxContext ?? 8192) - (snapshot.maxResponse ?? 0),
    getMaxContextTokens: () => snapshot.maxContext ?? 8192,
    getMaxResponseTokens: () => snapshot.maxResponse ?? 0,
    extension_prompts: snapshot.extensionPrompts ?? {}, input: snapshot.input ?? '',
    console: Object.fromEntries(['log', 'warn', 'debug', 'error'].map(level => [level,
      (...args) => diagnostics.push({ level, text: args.map(String).join(' ') })])),
  });
  return (text, overrides = {}, postProcess = value => value) => engine.evaluateMacros(text, {
    charPrompt: data.system_prompt ?? '', charInstruction: data.post_history_instructions ?? '',
    description: data.description ?? '', personality: data.personality ?? '', scenario: data.scenario ?? '',
    persona: snapshot.persona ?? '', mesExamplesRaw: data.mes_example ?? '',
    charVersion: data.character_version ?? '', charDepthPrompt: data.extensions?.depth_prompt?.prompt ?? '',
    creatorNotes: data.creator_notes ?? '', user: overrides.name1Override ?? snapshot.user ?? 'User',
    char: overrides.name2Override ?? data.name, group: data.name, charIfNotGroup: data.name,
    notChar: snapshot.user ?? 'User', model: snapshot.model ?? '', lastGenerationType: snapshot.operation ?? 'normal',
    ...(overrides.original !== undefined ? { original: overrides.original } : {}),
    ...overrides.dynamicMacros,
  }, postProcess);
}
