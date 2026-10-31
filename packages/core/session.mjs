import _ from 'lodash';
import { createMvuEngine } from './vendor/mvu.mjs';
import { createMacros } from './macros.mjs';
import { cardScripts } from './card.mjs';
import { createTemplateSession } from './template.mjs';
import { createRegexEngine } from './vendor/regex.mjs';

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
  runtimeState.variables = structuredClone(state.variables ?? {});
  const regex = createRegexEngine({ getRegexScripts: () => [...(templates?.getRegexes() ?? snapshot.globalRegex ?? []),
    ...(snapshot.presetRegex ?? []), ...(data.extensions?.regex_scripts ?? [])],
    substituteParams: macros, substituteParamsExtended: macros, extension_settings: { disabledExtensions: [] },
    console: Object.fromEntries(['log', 'debug', 'warn', 'error'].map(level => [level,
      (...args) => diagnostics.push({ level, text: args.map(String).join(' ') })])) });
  const templates = createTemplateSession({ ...snapshot, card, user, greeting }, runtimeState, {
    substitute: macros, regex: regex.getRegexedString, diagnostics, phase: snapshot.templatePhase ?? 'generate',
    messageId: snapshot.templateMessageId, host: snapshot.templateHost ?? { eventEmit },
  });
  const substitute = async (text, overrides = {}, transform = value => value) =>
    templates.evalTemplate(macros(String(text ?? ''), overrides, transform));
  // ST 扫描仍使用同步宏；EJS 等待最终提示词编排后按阶段执行。
  substitute.sync = macros;
  substitute.templates = templates;
  const mvu = createMvuEngine({ eventEmit, substitudeMacros: macros,
    getLorebookEntries: async () => {
      const entries = structuredClone(data.character_book?.entries ?? []);
      for (const entry of entries) if (/\[initvar\]/i.test(entry.comment ?? '') && entry.content?.includes('<%')) entry.content = await substitute(entry.content);
      return entries;
    },
    console: Object.fromEntries(['log', 'info', 'warn', 'error'].map(level => [level,
      (...args) => diagnostics.push({ level, text: args.map(String).join(' ') })])),
  });
  if (!templates.variables.stat_data) {
    templates.setVariables(mvu.createEmptyGameData());
    await mvu.loadInitVarData(templates.variables, [data.character_book?.name ?? data.name]);
  }
  await templates.initialize();
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
    const context = await templates.prepareContext();
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const args = { ...context, eventOn, eventEmit, _ };
    const run = new AsyncFunction(...Object.keys(args), script.content);
    await run(...Object.values(args));
  }
  if (!state.variables?.stat_data && greeting) {
    let override = null;
    for (const match of greeting.matchAll(/<(initvar)>(?:\s*```.*)?([\s\S]*?)(?:```\s*)?<\/\1>/gim)) {
      const parsed = mvu.parseString(await substitute(match[2].trim()));
      override = _.mergeWith(override ?? {}, parsed, (_lhs, rhs) => Array.isArray(rhs) ? rhs : undefined);
    }
    if (override) templates.variables.stat_data = override;
    await eventEmit(mvu.variable_events.VARIABLE_INITIALIZED, templates.variables, 0);
    const errors = [];
    await mvu.updateVariables(macros(greeting), templates.variables, errors);
    if (errors.length) throw new Error(errors.join('\n'));
  }
  return { substitute, templates, get variables() { return templates.variables; }, diagnostics, dependencies, runtimeState,
    takeEvents: () => events.splice(0),
    async update(text, { processed = false } = {}) {
      const errors = [];
      await mvu.updateVariables(processed ? text : await substitute(text), templates.variables, errors);
      if (errors.length) throw new Error(errors.join('\n'));
      return structuredClone(templates.variables);
    },
    dispose() { listeners.clear(); templates.dispose(); },
  };
}
