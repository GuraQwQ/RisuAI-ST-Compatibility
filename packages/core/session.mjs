import _ from 'lodash';
import ejs from 'ejs/ejs.min.js';
import { createMvuEngine } from './vendor/mvu.mjs';
import { createMacros } from './macros.mjs';
import { cardScripts } from './card.mjs';

export async function createCardSession(card, state = {}, user = 'User', greeting, snapshot = {}) {
  const data = card.data ?? card;
  const listeners = new Map();
  const diagnostics = [];
  const events = [];
  const runtimeState = structuredClone(state);
  const macros = createMacros({ ...snapshot, card, user, greeting }, runtimeState, diagnostics);
  const eventOn = (event, callback) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(callback);
    return { stop: () => listeners.get(event)?.delete(callback) };
  };
  const eventEmit = async (event, ...args) => {
    for (const callback of listeners.get(event) ?? []) await callback(...args);
    if (event.startsWith('mag_variable_')) events.push({ name: event, args: structuredClone(args) });
  };
  let variables = structuredClone(state.variables ?? {});
  const substitute = (text, overrides = {}, transform = value => value) => {
    let output = macros(String(text ?? ''), overrides, transform);
    if (output.includes('<%')) output = ejs.render(output, {
      _: _, getvar: key => _.get(variables, key), setvar: (key, value) => _.set(variables, key, value),
      variables, user, char: data.name,
    });
    return output;
  };
  const mvu = createMvuEngine({ eventEmit, substitudeMacros: substitute,
    getLorebookEntries: async () => structuredClone(data.character_book?.entries ?? []),
    console: Object.fromEntries(['log', 'info', 'warn', 'error'].map(level => [level,
      (...args) => diagnostics.push({ level, text: args.map(String).join(' ') })])),
  });
  if (!variables.stat_data) {
    variables = mvu.createEmptyGameData();
    await mvu.loadInitVarData(variables, [data.character_book?.name ?? data.name]);
  }
  const rawScripts = cardScripts(data);
  const seen = new Set();
  const dependencies = [];
  for (const item of rawScripts) {
    const script = item.value ?? item;
    if (script.enabled === false || !script.content || seen.has(script.id ?? script.content)) continue;
    seen.add(script.id ?? script.content);
    if (/\bimport\s*(?:\(|["'{*])|https?:\/\//.test(script.content)) {
      dependencies.push({ name: script.name, source: script.content });
      continue;
    }
    // 宿主通过专用 Worker 调用此模块；脚本监听器只存在于本次求值。
    const run = new Function('eventOn', 'eventEmit', '_', script.content);
    run(eventOn, eventEmit, _);
  }
  if (!state.variables?.stat_data && greeting) {
    let override = null;
    for (const match of greeting.matchAll(/<(initvar)>(?:\s*```.*)?([\s\S]*?)(?:```\s*)?<\/\1>/gim)) {
      const parsed = mvu.parseString(substitute(match[2].trim()));
      override = _.mergeWith(override ?? {}, parsed, (_lhs, rhs) => Array.isArray(rhs) ? rhs : undefined);
    }
    if (override) variables.stat_data = override;
    await eventEmit(mvu.variable_events.VARIABLE_INITIALIZED, variables, 0);
    const errors = [];
    await mvu.updateVariables(greeting, variables, errors);
    if (errors.length) throw new Error(errors.join('\n'));
  }
  return { substitute, variables, diagnostics, dependencies, runtimeState,
    takeEvents: () => events.splice(0),
    async update(text) {
      const errors = [];
      await mvu.updateVariables(text, variables, errors);
      if (errors.length) throw new Error(errors.join('\n'));
      return structuredClone(variables);
    },
    dispose() { listeners.clear(); },
  };
}
