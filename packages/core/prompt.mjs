import { createRuntime } from './runtime.mjs';
import { createPromptEngine } from './vendor/prompt.mjs';
import { attachGenerationImages } from './generation.mjs';

/** 接收宿主完整快照，在原生扫描、记忆、正则开始前构造一次请求。 */
export async function buildPrompt(snapshot, { countTokens, countMessages, substitute, events, signal } = {}) {
  const { card, chat, user, settings, books, globalRegex, presetRegex } = snapshot;
  const data = card.data ?? card;
  const templates = substitute?.templates;
  await templates?.beforeGenerate();
  const extensionPrompts = structuredClone(snapshot.extensionPrompts ?? {});
  const runtime = createRuntime({ card, user, settings, books, globalRegex, presetRegex,
    metadata: snapshot.state?.metadata, countTokens, substitute, events, extensionPrompts,
    worldbookBindings: snapshot.worldbookBindings });
  const render = (text, options = {}) => runtime.substituteParams(text ?? '', options);
  signal?.throwIfAborted();
  const filter = text => templates?.getFeatures().filter_message_enabled
    ? text.replace(/<%(?![%])([\s\S]*?)(?<!%)%>/g, '') : text;
  const history = chat.message.filter(message => !message.disabled && !message.isComment).map((message, index, all) => {
    const role = message.stCompatibility?.role ?? (message.role === 'char' ? 'assistant' : message.role ?? 'user');
    return { role, ...(snapshot.generation ? { stIdentifier: message.stIdentifier } : {}), content: filter(runtime.getRegexedString(message.data, role === 'user' ? 1 : 2,
      { isPrompt: true, depth: all.length - index - 1 })) };
  });
  if (!chat.stCompatibility?.greetingMaterialized && (snapshot.greeting ?? data.first_mes)) history.unshift({ role: 'assistant',
    content: filter(runtime.getRegexedString(snapshot.greeting ?? data.first_mes, 2, { isPrompt: true, depth: history.length })) });
  const depthPrompt = data.extensions?.depth_prompt;
  if (depthPrompt?.prompt) extensionPrompts.DEPTH_PROMPT = { value: depthPrompt.prompt, position: 1,
    depth: depthPrompt.depth ?? 4, role: ['system', 'user', 'assistant'].indexOf(depthPrompt.role ?? 'system'), scan: false };
  const world = await runtime.checkWorldInfo([...history].reverse().map(message => message.content),
    snapshot.maxContext, false, {
      trigger: snapshot.operation ?? 'normal', personaDescription: snapshot.persona ?? '',
      characterDescription: data.description ?? '', characterPersonality: data.personality ?? '',
      characterDepthPrompt: data.extensions?.depth_prompt?.prompt ?? '', scenario: data.scenario ?? '',
      creatorNotes: data.creator_notes ?? '',
    });
  const overrides = snapshot.generationOverrides ?? {};
  for (const entry of overrides.chat_history?.with_depth_entries === false ? [] : world.WIDepthEntries) extensionPrompts[`customDepthWI_${entry.depth}_${entry.role}`] = {
    value: entry.entries.join('\n'), position: 1, depth: entry.depth, role: entry.role, scan: false,
  };
  for (const [name, entries] of Object.entries(world.outletEntries)) extensionPrompts[`customWIOutlet_${name}`] = {
    value: entries.join('\n'), position: -1, depth: 0, role: 0,
  };
  if (snapshot.authorsNote || world.ANBeforeEntries.length || world.ANAfterEntries.length) extensionPrompts['2_floating_prompt'] = {
    value: [...world.ANBeforeEntries, snapshot.authorsNote?.content ?? '', ...world.ANAfterEntries].filter(Boolean).join('\n'),
    position: snapshot.authorsNote?.position ?? 1, depth: snapshot.authorsNote?.depth ?? 4,
    role: snapshot.authorsNote?.role ?? 0,
  };
  const counter = countMessages ?? (async value => {
    let count = 0;
    for (const message of Array.isArray(value) ? value : [value]) count += await countTokens(message.content ?? '') + 4 + (message.name ? await countTokens(message.name) : 0);
    return count;
  });
  const engine = createPromptEngine({ user, name: data.name, persona: snapshot.persona,
    preserveIdentifiers: !!snapshot.generation, raw: !!snapshot.generation?.raw, images: snapshot.generationImages,
    preset: snapshot.preset, promptOrderId: snapshot.promptOrderId, powerUser: snapshot.powerUser,
    maxContext: snapshot.maxContext, maxResponse: snapshot.maxResponse, extension_prompts: extensionPrompts,
    substituteParams: render, countMessages: counter, emit: events,
    console: Object.fromEntries(['log', 'warn', 'debug', 'error'].map(level => [level,
      (...args) => runtime.trace.push({ level, text: args.map(String).join(' ') })])),
  });
  const exampleBlocks = [
    ...world.EMEntries.filter(item => item.position === 0).flatMap(item => engine.parseMesExamples(item.content, false)),
    ...engine.parseMesExamples(data.mes_example ?? '', false),
    ...world.EMEntries.filter(item => item.position === 1).flatMap(item => engine.parseMesExamples(item.content, false)),
  ];
  const result = await engine.build({ charDescription: data.description ?? '', charPersonality: data.personality ?? '',
    scenario: data.scenario ?? '', worldInfoBefore: overrides.world_info_before ?? world.worldInfoBefore,
    worldInfoAfter: overrides.world_info_after ?? world.worldInfoAfter,
    systemPromptOverride: data.system_prompt || undefined, jailbreakPromptOverride: data.post_history_instructions || undefined,
    type: snapshot.operation ?? 'normal', messages: [...history].reverse(),
    messageExamples: exampleBlocks.map(block => engine.parseExampleIntoIndividual(render(block))),
    cyclePrompt: snapshot.operation === 'continue' ? history.at(-1)?.content : undefined,
  });
  signal?.throwIfAborted();
  const messages = templates ? await templates.processPrompt(result.messages) : result.messages;
  return { messages, tokens: templates ? await counter(snapshot.generation ? attachGenerationImages(messages, snapshot) : messages)
    : snapshot.maxContext - (snapshot.maxResponse ?? 0) - result.remaining,
    metadata: runtime.metadata, world: [...world.allActivatedEntries], trace: runtime.trace };
}
