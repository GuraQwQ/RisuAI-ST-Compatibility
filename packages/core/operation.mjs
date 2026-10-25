import { buildPrompt } from './prompt.mjs';
import { createRuntime } from './runtime.mjs';
import { createCardSession } from './session.mjs';
import { historyState, messageLineage } from './history.mjs';

export async function evaluateCardOperation(message, { countTokens, countMessages }) {
  let session;
  try {
    const { snapshot, operation, text, index, role } = message;
    let recovered;
    if (['prompt', 'display', 'input', 'edit'].includes(operation)) {
      const end = operation === 'display' ? index + 1 : operation === 'edit' ? index
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
          const variables = historical.role === 'char' ? await old.update(historical.data) : structuredClone(old.variables);
          return { ...old.runtimeState, variables };
        } finally { old.dispose(); }
      }, Math.max(0, end));
      snapshot.state = recovered.state;
    }
    session = await createCardSession(snapshot.card, snapshot.state, snapshot.user, snapshot.greeting, snapshot);
    const runtime = createRuntime({ card: snapshot.card, countTokens,
      user: snapshot.user, substitute: session.substitute });
    let result;
    if (operation === 'prompt') {
      result = await buildPrompt({ ...snapshot, state: session.runtimeState }, { countTokens, countMessages, substitute: session.substitute });
      result.variables = session.variables;
      result.dependencies = session.dependencies;
      result.globals = session.runtimeState.globals;
      result.metadata.variables = session.runtimeState.metadata.variables;
      result.lineage = recovered.lineage;
      result.historyUpdates = recovered.updates;
    } else if (operation === 'output') {
      session.takeEvents();
      const variables = await session.update(text);
      result = { text: runtime.getRegexedString(text, 2, { isEdit: message.isEdit }), variables, diagnostics: session.diagnostics,
        metadata: session.runtimeState.metadata, globals: session.runtimeState.globals, events: session.takeEvents() };
    } else if (operation === 'parseMvu') {
      session.takeEvents();
      const variables = await session.update(text);
      result = { variables, events: session.takeEvents(), metadata: session.runtimeState.metadata, globals: session.runtimeState.globals };
    } else if (operation === 'display') {
      const initial = await createCardSession(snapshot.card, {}, snapshot.user, snapshot.greeting, snapshot);
      result = { text: runtime.getRegexedString(text, role === 'user' ? 1 : 2,
        { isMarkdown: true, depth: snapshot.chat.message.length - index - 1 }), variables: session.variables,
        states: recovered.states, initialVariables: initial.variables, lineage: recovered.lineage,
        metadata: session.runtimeState.metadata, globals: session.runtimeState.globals };
      initial.dispose();
    } else {
      const processed = runtime.getRegexedString(text, role === 'char' ? 2 : 1, { isEdit: operation === 'edit' });
      const variables = await session.update(processed);
      result = { text: processed, variables, events: session.takeEvents(),
        metadata: session.runtimeState.metadata, globals: session.runtimeState.globals,
        lineage: recovered?.lineage, historyUpdates: recovered?.updates };
    }
    if (message.outputMessage) result.lineage = await messageLineage(message.parentLineage ?? result.lineage, { ...message.outputMessage, data: result.text });
    return result;
  } catch (error) {
    error.events = session?.takeEvents() ?? [];
    throw error;
  } finally { session?.dispose(); }
}
