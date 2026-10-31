import { buildPrompt } from './prompt.mjs';
import { createRuntime } from './runtime.mjs';
import { createCardSession } from './session.mjs';
import { historyState, messageLineage } from './history.mjs';

export async function evaluateCardOperation(message, { countTokens, countMessages }) {
  let session;
  try {
    const { snapshot, operation, text, index, role } = message;
    const liveGlobals = snapshot.state?.globals, liveLocals = snapshot.state?.metadata?.variables,
      liveTemplate = snapshot.state?.template;
    const unprocessed = operation === 'display' && text?.includes('<%') && !(index < 0
      ? snapshot.chat.stCompatibility?.greetingTemplateProcessed : snapshot.chat.message[index]?.stCompatibility?.templateProcessed);
    let recovered;
    if (['prompt', 'display', 'input', 'edit'].includes(operation) && !(operation === 'prompt' && snapshot.generation)) {
      const end = operation === 'display' ? index + Number(!unprocessed) : operation === 'edit' ? index
        : snapshot.operation === 'continue' ? snapshot.chat.message.length - 1 : snapshot.chat.message.length;
      recovered = await historyState(snapshot, async ({ message: historical, index: position, state }) => {
        if (historical.isComment || historical.disabled) return state;
        const partial = { ...snapshot, chat: { ...snapshot.chat, message: snapshot.chat.message.slice(0, position) }, state };
        const old = await createCardSession(snapshot.card, state, snapshot.user, snapshot.greeting, partial);
        try {
          if (historical.role === 'char') {
            const prompt = await buildPrompt({ ...partial, state: old.runtimeState }, { countTokens, countMessages, substitute: old.substitute });
            old.runtimeState.metadata.timedWorldInfo = prompt.metadata.timedWorldInfo;
          }
          const output = await old.templates.processOutput(historical.data);
          const variables = historical.role === 'char' ? await old.update(output, { processed: true }) : structuredClone(old.variables);
          old.templates.effects();
          return { ...old.runtimeState, variables };
        } finally { old.dispose(); }
      }, Math.max(0, end));
      snapshot.state = { ...recovered.state, globals: liveGlobals ?? recovered.state.globals,
        metadata: { ...recovered.state.metadata, ...(liveLocals === undefined ? {} : { variables: liveLocals }) },
        template: liveTemplate ?? recovered.state.template };
    }
    const contextSnapshot = structuredClone(snapshot);
    if (snapshot.templateChat) contextSnapshot.chat = structuredClone(snapshot.templateChat);
    if (Object.hasOwn(snapshot, 'templateGreeting')) contextSnapshot.greeting = snapshot.templateGreeting;
    const greetingOffset = Number(!contextSnapshot.chat.stCompatibility?.greetingMaterialized);
    if (message.outputMessage) {
      const output = { ...message.outputMessage, data: text };
      const existing = contextSnapshot.chat.message.findIndex(item => item.chatId === output.chatId);
      if (existing < 0) contextSnapshot.chat.message.push(output);
      else contextSnapshot.chat.message[existing] = output;
      contextSnapshot.templateMessageId = (existing < 0 ? contextSnapshot.chat.message.length - 1 : existing) + greetingOffset;
    } else if (operation === 'display' || operation === 'edit') contextSnapshot.templateMessageId = Math.max(0, index + greetingOffset);
    session = await createCardSession(snapshot.card, snapshot.state, snapshot.user, contextSnapshot.greeting, contextSnapshot);
    const runtime = createRuntime({ card: snapshot.card, countTokens, globalRegex: snapshot.globalRegex, presetRegex: snapshot.presetRegex,
      user: snapshot.user, substitute: session.substitute });
    let result;
    if (operation === 'prompt') {
      result = await buildPrompt({ ...snapshot, state: session.runtimeState }, { countTokens, countMessages, substitute: session.substitute });
      result.variables = session.variables;
      result.diagnostics = session.diagnostics;
      result.dependencies = session.dependencies;
      result.globals = session.runtimeState.globals;
      result.metadata.variables = session.runtimeState.metadata.variables;
      result.lineage = recovered?.lineage;
      result.historyUpdates = recovered?.updates;
    } else if (operation === 'output') {
      session.takeEvents();
      const rendered = await session.templates.processOutput(text);
      const variables = await session.update(rendered, { processed: true });
      result = { text: runtime.getRegexedString(rendered, 2, { isEdit: message.isEdit }), variables, diagnostics: session.diagnostics, templateProcessed: true,
        metadata: session.runtimeState.metadata, globals: session.runtimeState.globals, events: session.takeEvents() };
    } else if (operation === 'parseMvu') {
      session.takeEvents();
      const variables = await session.update(text);
      result = { variables, events: session.takeEvents(), metadata: session.runtimeState.metadata, globals: session.runtimeState.globals };
    } else if (operation === 'templatePrompt') {
      result = { messages: await session.templates.processPrompt(structuredClone(message.messages ?? [])) };
    } else if (operation === 'customOutput') {
      result = { text: await session.templates.processOutput(text), diagnostics: session.diagnostics };
    } else if (operation === 'template') {
      const args = message.args ?? [], method = message.method;
      if (method === 'evalTemplate') result = { value: await session.templates.evalTemplate(args[0], await session.templates.prepareContext(args[1] ?? {}), args[2]) };
      else if (['allVariables', 'getFeatures', 'setFeatures', 'resetFeatures', 'getSyntaxErrorInfo', 'refreshWorldInfo', 'saveVariables', 'parseJSON', 'jsonPatch'].includes(method)) {
        result = { value: await session.templates[method](...args) };
      } else if (method === 'defines' || method === 'initialVariables') result = { value: session.templates[method] };
      else throw new Error(`模板接口不存在：${method}`);
    } else if (operation === 'display') {
      const initial = await createCardSession(snapshot.card, {}, snapshot.user, snapshot.greeting, snapshot);
      const firstRender = !(index < 0 ? snapshot.chat.stCompatibility?.greetingTemplateRendered
        : snapshot.chat.message[index]?.stCompatibility?.templateRendered);
      let permanentText = text;
      if (unprocessed) {
        permanentText = await session.templates.processOutput(text);
        await session.update(permanentText, { processed: true });
      }
      const display = runtime.getRegexedString(permanentText, role === 'user' ? 1 : 2,
        { isMarkdown: true, depth: snapshot.chat.message.length - index - 1 });
      result = { text: await session.templates.processOutput(display, { renderOnly: true,
        messageId: Math.max(0, index + greetingOffset), dryRun: !firstRender }), variables: session.variables,
        ...(unprocessed ? { permanentText, templateProcessed: true } : {}),
        ...(firstRender ? { templateRendered: true } : {}),
        states: recovered.states, initialVariables: initial.variables, lineage: recovered.lineage,
        metadata: session.runtimeState.metadata, globals: session.runtimeState.globals };
      initial.dispose();
    } else {
      const processed = runtime.getRegexedString(text, role === 'char' ? 2 : 1, { isEdit: operation === 'edit' });
      const rendered = await session.templates.processOutput(processed);
      const variables = await session.update(rendered, { processed: true });
      result = { text: rendered, variables, events: session.takeEvents(), templateProcessed: true,
        metadata: session.runtimeState.metadata, globals: session.runtimeState.globals,
        lineage: recovered?.lineage, historyUpdates: recovered?.updates };
    }
    const effects = session.templates.effects();
    result.variables ??= effects.variables;
    result.globals ??= effects.globals;
    result.metadata = { ...effects.metadata, ...result.metadata, variables: effects.metadata.variables };
    result.templateState = effects.templateState;
    result.messageVariables = effects.messageVariables;
    if (unprocessed && index >= 0) {
      result.lineage = await messageLineage(recovered.lineage, { ...snapshot.chat.message[index], data: result.permanentText });
      result.states.push({ ...session.runtimeState, variables: result.variables });
    }
    if (message.outputMessage) result.lineage = await messageLineage(message.parentLineage ?? result.lineage, { ...message.outputMessage, data: result.text });
    return result;
  } catch (error) {
    error.events = session?.takeEvents() ?? [];
    throw error;
  } finally { session?.dispose(); }
}
